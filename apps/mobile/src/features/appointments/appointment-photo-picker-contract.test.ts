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
});
