#!/usr/bin/env node
// СБОРКА ДИЗАЙН-СИСТЕМЫ BABUN ДЛЯ CLAUDE DESIGN (cfg.buildCmd).
//
// Блоки Babun — React Native. Claude Design рисует дизайны в браузере, поэтому
// блоки собираются ДЛЯ ВЕБА — тем же Metro и теми же преобразованиями
// (NativeWind, react-native-web, reanimated), что и веб-версия приложения.
// Это настоящий код блоков, а не перерисовка.
//
// На выходе — пакет `ds-dist/` (в .gitignore), который конвертер design-sync
// берёт как обычный `dist/`:
//   babun-ui.web.js   код всех блоков (Metro), кладёт их на window.__BabunUI;
//                     React и ReactDOM — у страницы (подмены в
//                     apps/mobile/ds-web/shims, включаются BABUN_DS_WEB=1)
//   index.mjs         именованные экспорты поверх window.__BabunUI
//   babun.css         Tailwind-стили приложения из его веб-экспорта
//   types/ + index.d.ts  описания свойств (tsc), пути `@/…` переписаны
//                        в относительные — их читает ts-morph конвертера
//
// Сервер сборки (Expo на :8083 с BABUN_DS_WEB=1) скрипт поднимает и гасит
// сам; рабочий Metro приложения на :8081 не трогается.
// Запуск: node .design-sync/build-web.mjs [--skip-css] [--skip-types]
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(ROOT, 'apps', 'mobile');
const OUT = join(ROOT, 'ds-dist');
const SERVER = process.env.BABUN_DS_SERVER ?? 'http://localhost:8083';
const skip = (f) => process.argv.includes(f);

function walk(dir, pick) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, pick));
    else if (pick(p)) out.push(p);
  }
  return out;
}

// -- 0. имена экспортов — из apps/mobile/ds-web/exports.ts ------------------
const exportsSrc = readFileSync(join(APP, 'ds-web', 'exports.ts'), 'utf8');
const names = [
  ...[...exportsSrc.matchAll(/export\s*\{([^}]*)\}\s*from/g)].flatMap((m) => m[1].split(',')),
  ...[...exportsSrc.matchAll(/export\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from/g)].map((m) => m[1]),
]
  .map((s) => s.trim())
  .filter(Boolean);
if (names.length === 0) throw new Error('exports.ts: ни одного экспорта');
console.error(`» ${names.length} экспортов из ds-web/exports.ts`);

mkdirSync(OUT, { recursive: true });

// -- 1. код блоков — Metro сервера сборки ------------------------------------
// Сервер поднимается ЗАНОВО на каждую сборку и гасится после неё: у живого
// Metro граф запроса инкрементальный, и после правки входа он падал с «Got
// unexpected undefined» (21.09). Свежий сервер — свежий граф. Рабочий Metro
// приложения (:8081) не трогается: порт и кэш-граф свои.
const PORT = Number(new URL(SERVER).port || 8083);
const alive = async () =>
  (await fetch(`${SERVER}/status`).then((r) => r.text()).catch(() => '')).includes('running');
if (await alive()) {
  throw new Error(`на ${SERVER} уже кто-то слушает — останови его, сборка поднимает свой сервер`);
}
const server = spawn('npx', ['expo', 'start', '--port', String(PORT)], {
  cwd: APP,
  env: { ...process.env, BABUN_DS_WEB: '1' },
  stdio: 'ignore',
  detached: true,
});
const stopServer = () => {
  try {
    process.kill(-server.pid, 'SIGTERM');
  } catch {
    /* уже остановлен */
  }
};
process.on('exit', stopServer);
for (let i = 0; i < 90 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 1000));
if (!(await alive())) throw new Error(`сервер сборки не поднялся на ${SERVER} за 90 с`);
try {
  const url =
    `${SERVER}/apps/mobile/ds-web/entry.bundle?platform=web&dev=false&minify=false&hot=false` +
    '&lazy=false&transform.routerRoot=app&resolver.environment=client&transform.environment=client';
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`Metro ${res.status}: ${body.slice(0, 2000)}`);
  // Свой React в бандле — два экземпляра React на странице и мёртвые хуки.
  // Сервер без BABUN_DS_WEB=1 его бы и вшил: проверяем, а не надеемся.
  if (/react\.production|react\.development|ReactSharedInternals\b/.test(body)) {
    throw new Error('в бандл попал собственный React — сервер сборки запущен без BABUN_DS_WEB=1?');
  }
  writeFileSync(join(OUT, 'babun-ui.web.js'), body);
  console.error(`  код: ${(body.length / 1024).toFixed(0)} KB`);
} finally {
  stopServer();
}

// -- 2. именованные экспорты поверх window.__BabunUI --------------------------
writeFileSync(
  join(OUT, 'index.mjs'),
  '// Сгенерировано .design-sync/build-web.mjs — не править руками.\n' +
    'import "./babun-ui.web.js";\n' +
    'const U = globalThis.__BabunUI;\n' +
    names.map((n) => `export const ${n} = U.${n};`).join('\n') +
    '\n',
);

// -- 3. стили — Tailwind из веб-экспорта приложения ---------------------------
if (!skip('--skip-css')) {
  const exportDir = join(OUT, '.export');
  rmSync(exportDir, { recursive: true, force: true });
  // Обычная сборка приложения (без подмен React): стили те же, что в вебе.
  const env = { ...process.env };
  delete env.BABUN_DS_WEB;
  execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', exportDir], {
    cwd: APP,
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const cssDir = join(exportDir, '_expo', 'static', 'css');
  const css = readdirSync(cssDir).filter((f) => f.endsWith('.css'));
  if (css.length !== 1) throw new Error(`ожидался один css в экспорте, найдено: ${css.join(', ')}`);
  copyFileSync(join(cssDir, css[0]), join(OUT, 'babun.css'));
  // Правки ТОЛЬКО для Claude Design. Открытая шторка на статичном кадре
  // ставит фокус на затемнение («Закрыть»), и браузер обводит весь экран синей
  // рамкой :focus-visible. В приложении шторку открывают касанием, и рамки нет.
  writeFileSync(
    join(OUT, 'babun.css'),
    readFileSync(join(OUT, 'babun.css'), 'utf8') +
      '\n/* design-sync: статичный кадр открытой шторки — без рамки фокуса */\n' +
      '[aria-modal="true"] [aria-label="Закрыть"]:focus,' +
      '[aria-modal="true"] [aria-label="Закрыть"]:focus-visible{outline:none}\n',
  );
  rmSync(exportDir, { recursive: true, force: true });
  console.error(`  стили: ${css[0]}`);
}

// -- 4. описания свойств — tsc, пути @/ → относительные ------------------------
if (!skip('--skip-types')) {
  const typesDir = join(OUT, 'types');
  rmSync(typesDir, { recursive: true, force: true });
  const tsconfig = join(OUT, 'tsconfig.types.json');
  writeFileSync(
    tsconfig,
    JSON.stringify(
      {
        extends: join(APP, 'tsconfig.json'),
        compilerOptions: {
          noEmit: false,
          declaration: true,
          emitDeclarationOnly: true,
          noEmitOnError: false,
          skipLibCheck: true,
          rootDir: ROOT,
          outDir: typesDir,
        },
        include: [],
        files: [
          join(APP, 'ds-web', 'exports.ts'),
          join(APP, 'expo-env.d.ts'),
          join(APP, 'nativewind-env.d.ts'),
        ],
      },
      null,
      2,
    ),
  );
  try {
    execFileSync(join(ROOT, 'node_modules', '.bin', 'tsc'), ['-p', tsconfig], {
      cwd: APP,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch {
    // Ошибки типов не останавливают выпуск описаний: tsc всё равно пишет
    // .d.ts, а проверку типов держит `tsc --noEmit` самого приложения.
    console.error('  ! tsc сообщил ошибки — описания всё равно выпущены');
  }
  const appTypes = join(typesDir, 'apps', 'mobile');
  const srcTypes = join(appTypes, 'src');
  for (const file of walk(appTypes, (p) => p.endsWith('.d.ts'))) {
    const text = readFileSync(file, 'utf8');
    const fixed = text.replace(/(["'])@\/([^"']+)\1/g, (_, q, rest) => {
      let rel = relative(dirname(file), join(srcTypes, rest)).split(sep).join('/');
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return `${q}${rel}${q}`;
    });
    if (fixed !== text) writeFileSync(file, fixed);
  }
  writeFileSync(
    join(OUT, 'index.d.ts'),
    '// Сгенерировано .design-sync/build-web.mjs — не править руками.\n' +
      'export * from "./types/apps/mobile/ds-web/exports";\n',
  );
  console.error('  описания: types/');
}

// -- 5. package.json пакета ----------------------------------------------------
const appPkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
writeFileSync(
  join(OUT, 'package.json'),
  JSON.stringify(
    {
      name: '@babun/ui',
      version: /^\d+\.\d+\.\d+/.test(appPkg.version ?? '') ? appPkg.version : '0.1.0',
      private: true,
      module: 'index.mjs',
      types: 'index.d.ts',
    },
    null,
    2,
  ) + '\n',
);
if (!existsSync(join(OUT, 'babun.css'))) console.error('  ! babun.css нет — запусти без --skip-css');
console.error(`» готово: ${OUT}`);
