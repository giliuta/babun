import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const appointmentSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "use-file-pickers.ts"),
  "utf8",
);
const clientPage = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../app/(dashboard)/clients/attachments.tsx",
  ),
  "utf8",
);
const clientFiles = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../clients/use-client-files.ts"),
  "utf8",
);
const addSheet = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "FileAddSheet.tsx"),
  "utf8",
);
const appJson = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../app.json"), "utf8"),
) as { expo: { plugins?: (string | [string, Record<string, unknown>?])[] } };

/** Тело вызова `fn({ … })` — до первой закрывающей `})`. */
function callBody(source: string, fn: string): string {
  const start = source.indexOf(`${fn}({`);
  assert.ok(start >= 0, `нет вызова ${fn}`);
  return source.slice(start, source.indexOf("})", start));
}

function assertCompatiblePicker(source: string): void {
  assert.match(
    source,
    /preferredAssetRepresentationMode:\s*\n\s*ImagePicker\.UIImagePickerPreferredAssetRepresentationMode\.Compatible/,
  );
  assert.doesNotMatch(
    source,
    /preferredAssetRepresentationMode:\s*\n\s*ImagePicker\.UIImagePickerPreferredAssetRepresentationMode\.(?:Automatic|Current)/,
  );
}

describe("appointment photo picker", () => {
  test("requests an iOS-compatible representation before upload", () => {
    assertCompatiblePicker(appointmentSource);
    // Файлы клиента (03.10) выбирают тем же `useFilePickers`, что и запись:
    // своего вызова галереи у страницы нет — значит, и своего режима тоже.
    assert.match(clientFiles, /useFilePickers\(/);
    assert.match(clientPage, /useClientFileUpload\(id\)/);
    assert.doesNotMatch(clientPage, /launchImageLibraryAsync|launchCameraAsync/);
  });

  // Выпуск в App Store, 06.10: видео с камеры пишет звук, а микрофон в
  // сборке выключен — expo-image-picker бросал
  // MissingMicrophonePermissionException, и камера на живом iPhone не
  // открывалась. Камера — только фото; видео — из галереи.
  test("camera captures photos only while the build has no microphone", () => {
    const picker = (appJson.expo.plugins ?? []).find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-image-picker",
    );
    assert.ok(Array.isArray(picker));
    assert.equal(picker[1]?.microphonePermission, false);

    const camera = callBody(appointmentSource, "ImagePicker.launchCameraAsync");
    assert.match(camera, /mediaTypes: \["images"\],/);
    assert.doesNotMatch(camera, /videos|videoMaxDuration|videoQuality/);
    assert.match(callBody(appointmentSource, "ImagePicker.launchImageLibraryAsync"), /mediaTypes: \["images", "videos"\],/);

    assert.match(addSheet, /label: "Снять фото",/);
    assert.doesNotMatch(addSheet, /Снять фото или видео/);
  });

  test("gallery opens the system picker without a library permission prompt", () => {
    // PHPicker (iOS) и Photo Picker (Android) отдают только выбранное —
    // доступа к медиатеке им не нужно.
    assert.doesNotMatch(appointmentSource, /requestMediaLibraryPermissionsAsync/);
    assert.match(appointmentSource, /requestCameraPermissionsAsync/);
  });

  test("picker failures never show the raw native error text", () => {
    assert.doesNotMatch(appointmentSource, /\.message\b/);
    for (const title of [
      "Не удалось открыть камеру",
      "Не удалось открыть галерею",
      "Не удалось выбрать файл",
      "Не удалось отсканировать",
    ]) {
      assert.ok(appointmentSource.includes(`notify("${title}", "Попробуйте ещё раз.");`), title);
    }
  });
});
