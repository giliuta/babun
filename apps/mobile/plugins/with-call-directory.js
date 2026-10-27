// ОПРЕДЕЛИТЕЛЬ НОМЕРА НА iPHONE — расширение Call Directory в нативной сборке.
//
// Папки `ios/` в git нет (её рождает `expo prebuild`), поэтому цель
// расширения дописывает этот плагин при каждой сборке:
//   • App Group `group.<bundle id>` — у приложения и у расширения, через её
//     общий контейнер приложение передаёт список номеров;
//   • ключи `BabunAppGroup` и `BabunCallDirectoryExtension` в Info.plist
//     приложения — их читает модуль `modules/caller-id`, а не угадывает;
//   • цель `BabunCallDirectory` (app extension) с кодом из
//     `modules/caller-id/extension`, вшитая в приложение.
//
// Bundle id расширения — `<bundle id приложения>.CallDirectory`: у боевого
// `com.babun.crm.CallDirectory`, у dev-клиента `com.babun.crm.dev.CallDirectory`.
// Обе App Group и оба id должны быть заведены в Apple Developer — иначе
// подписать сборку нельзя.

const fs = require("fs");
const path = require("path");
const {
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require("expo/config-plugins");

const TARGET = "BabunCallDirectory";
const SOURCE_FILE = "CallDirectoryHandler.swift";
const INFO_PLIST = `${TARGET}-Info.plist`;
const ENTITLEMENTS = `${TARGET}.entitlements`;
const SOURCE_DIR = path.join(__dirname, "..", "modules", "caller-id", "extension");
const GROUPS_KEY = "com.apple.security.application-groups";

function idsOf(config) {
  const appId = config.ios?.bundleIdentifier;
  if (!appId) throw new Error("with-call-directory: ios.bundleIdentifier is required");
  return { appId, extensionId: `${appId}.CallDirectory`, group: `group.${appId}` };
}

function infoPlist(group, displayName) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>BabunAppGroup</key>
  <string>${group}</string>
  <key>CFBundleDevelopmentRegion</key>
  <string>$(DEVELOPMENT_LANGUAGE)</string>
  <key>CFBundleDisplayName</key>
  <string>${displayName}</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundlePackageType</key>
  <string>$(PRODUCT_BUNDLE_PACKAGE_TYPE)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.callkit.call-directory</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).CallDirectoryHandler</string>
  </dict>
</dict>
</plist>
`;
}

function entitlementsPlist(group) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>${GROUPS_KEY}</key>
  <array>
    <string>${group}</string>
  </array>
</dict>
</plist>
`;
}

const withAppGroup = (config) =>
  withEntitlementsPlist(config, (mod) => {
    const { group } = idsOf(mod);
    const groups = mod.modResults[GROUPS_KEY] ?? [];
    if (!groups.includes(group)) mod.modResults[GROUPS_KEY] = [...groups, group];
    return mod;
  });

const withAppKeys = (config) =>
  withInfoPlist(config, (mod) => {
    const { extensionId, group } = idsOf(mod);
    mod.modResults.BabunAppGroup = group;
    mod.modResults.BabunCallDirectoryExtension = extensionId;
    return mod;
  });

const withExtensionFiles = (config) =>
  withDangerousMod(config, [
    "ios",
    async (mod) => {
      const { group } = idsOf(mod);
      const dir = path.join(mod.modRequest.platformProjectRoot, TARGET);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(path.join(SOURCE_DIR, SOURCE_FILE), path.join(dir, SOURCE_FILE));
      // Имя расширения человек видит в Настройках → «Блокировка и
      // идентификация вызовов»: оно то же, что у приложения.
      fs.writeFileSync(path.join(dir, INFO_PLIST), infoPlist(group, mod.name));
      fs.writeFileSync(path.join(dir, ENTITLEMENTS), entitlementsPlist(group));
      return mod;
    },
  ]);

/** Значение настройки первой сборки приложения — команда подписи и версия
 *  расширения обязаны совпадать с приложением. */
function appBuildSetting(project, key) {
  const configs = project.pbxXCBuildConfigurationSection();
  for (const id of Object.keys(configs)) {
    const settings = configs[id]?.buildSettings;
    if (settings?.PRODUCT_BUNDLE_IDENTIFIER && settings[key] != null) return settings[key];
  }
  return undefined;
}

const withExtensionTarget = (config) =>
  withXcodeProject(config, (mod) => {
    const project = mod.modResults;
    if (project.pbxTargetByName(TARGET)) return mod;
    const { extensionId } = idsOf(mod);
    const appTarget = project.getFirstTarget();

    const group = project.addPbxGroup([SOURCE_FILE, INFO_PLIST, ENTITLEMENTS], TARGET, TARGET);
    const mainGroup = project.getFirstProject().firstProject.mainGroup;
    project.addToPbxGroup(group.uuid, mainGroup);

    // `addTarget` сам заводит в приложении фазу копирования с папкой
    // PlugIns (13) и кладёт туда .appex — это и есть вшивание расширения.
    const target = project.addTarget(TARGET, "app_extension", TARGET, extensionId);
    project.addBuildPhase([SOURCE_FILE], "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    project.addTargetDependency(appTarget.uuid, [target.uuid]);

    const team = appBuildSetting(project, "DEVELOPMENT_TEAM");
    const settings = {
      INFOPLIST_FILE: `${TARGET}/${INFO_PLIST}`,
      CODE_SIGN_ENTITLEMENTS: `${TARGET}/${ENTITLEMENTS}`,
      CODE_SIGN_STYLE: "Automatic",
      PRODUCT_BUNDLE_IDENTIFIER: extensionId,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SWIFT_VERSION: "5.0",
      IPHONEOS_DEPLOYMENT_TARGET: appBuildSetting(project, "IPHONEOS_DEPLOYMENT_TARGET") ?? "15.1",
      TARGETED_DEVICE_FAMILY: '"1"',
      MARKETING_VERSION: mod.version ?? "1.0.0",
      CURRENT_PROJECT_VERSION: mod.ios?.buildNumber ?? "1",
      GENERATE_INFOPLIST_FILE: "NO",
      APPLICATION_EXTENSION_API_ONLY: "YES",
      CLANG_ENABLE_MODULES: "YES",
      SKIP_INSTALL: "YES",
      ...(team ? { DEVELOPMENT_TEAM: team } : null),
    };
    const configs = project.pbxXCBuildConfigurationSection();
    const listId = project.pbxNativeTargetSection()[target.uuid].buildConfigurationList;
    const list = project.pbxXCConfigurationList()[listId];
    for (const { value } of list.buildConfigurations) {
      Object.assign(configs[value].buildSettings, settings);
    }
    return mod;
  });

module.exports = function withCallDirectory(config) {
  config = withAppGroup(config);
  config = withAppKeys(config);
  config = withExtensionFiles(config);
  config = withExtensionTarget(config);
  return config;
};
