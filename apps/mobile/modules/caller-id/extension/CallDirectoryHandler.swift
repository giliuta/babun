import CallKit
import Foundation

// РАСШИРЕНИЕ «ОПРЕДЕЛИТЕЛЬ НОМЕРА». iOS зовёт его, когда приложение попросило
// перезагрузить базу (`CXCallDirectoryManager.reloadExtension`) или когда
// человек включил его в Настройках. Список готовит приложение: файл
// `caller-id.txt` в общем контейнере App Group, строка на номер —
// «цифры E.164<TAB>подпись», номера уже по возрастанию и без повторов
// (`caller-id-entries.ts`).
//
// Каждый запрос — ПОЛНАЯ перезапись: в инкрементальном запросе база сначала
// очищается. Так удалённый клиент или сменённый номер не остаётся в телефоне
// навсегда, а расширению не нужно помнить прошлый список.
//
// CallKit отвергает весь запрос, если номер не больше предыдущего, поэтому
// такая строка пропускается здесь ещё раз — испорченный файл стоит одной
// подписи, а не всех.

final class CallDirectoryHandler: CXCallDirectoryProvider {
  override func beginRequest(with context: CXCallDirectoryExtensionContext) {
    context.delegate = self
    if context.isIncremental {
      context.removeAllIdentificationEntries()
    }
    if let text = Self.readList() {
      var previous: CXCallDirectoryPhoneNumber = 0
      text.enumerateLines { line, _ in
        guard let tab = line.firstIndex(of: "\t"),
              let number = CXCallDirectoryPhoneNumber(line[..<tab]),
              number > previous
        else { return }
        let label = String(line[line.index(after: tab)...])
        context.addIdentificationEntry(withNextSequentialPhoneNumber: number, label: label)
        previous = number
      }
    }
    context.completeRequest()
  }

  private static func readList() -> String? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "BabunAppGroup") as? String,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return try? String(contentsOf: container.appendingPathComponent("caller-id.txt"), encoding: .utf8)
  }
}

extension CallDirectoryHandler: CXCallDirectoryExtensionContextDelegate {
  func requestFailed(for extensionContext: CXCallDirectoryExtensionContext, withError error: Error) {
    // Ошибку видит приложение: `reloadExtension` возвращает её в JS.
  }
}
