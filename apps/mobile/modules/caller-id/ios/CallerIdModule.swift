import CallKit
import ExpoModulesCore

// МОСТ ОПРЕДЕЛИТЕЛЯ НОМЕРА: приложение пишет список номеров клиентов в общий
// контейнер App Group, а расширение Call Directory читает его, когда iOS
// просит обновить базу. Имя группы и id расширения кладёт в Info.plist
// config plugin (`plugins/with-call-directory.js`) — у боевого и dev-клиента
// они свои, и модуль не угадывает их по bundle id.
//
// Сборка без расширения (старый dev-клиент, симулятор соседа) отвечает
// `isConfigured() == false`, и экран прячет строку целиком.

private let listFileName = "caller-id.txt"

public class CallerIdModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BabunCallerId")

    Function("isConfigured") { () -> Bool in
      return Self.listURL() != nil && Self.extensionId() != nil
    }

    // Пишет файл, только если он изменился: `true` — содержимое новое, и
    // базу iOS стоит перезагрузить. Перезагрузка не бесплатна (расширение
    // перечитывает весь список), поэтому без изменений её не зовут.
    AsyncFunction("writeList") { (text: String) throws -> Bool in
      guard let url = Self.listURL() else {
        throw CallerIdNotConfiguredException()
      }
      let data = Data(text.utf8)
      if let current = try? Data(contentsOf: url), current == data {
        return false
      }
      try data.write(to: url, options: .atomic)
      return true
    }

    AsyncFunction("reload") { (promise: Promise) in
      guard let id = Self.extensionId() else {
        promise.reject(CallerIdNotConfiguredException())
        return
      }
      CXCallDirectoryManager.sharedInstance.reloadExtension(withIdentifier: id) { error in
        if let error = error as NSError? {
          // Код CXErrorCodeCallDirectoryManagerError уходит в JS числом:
          // 6 — расширение выключено в Настройках, это не поломка.
          promise.reject("ERR_CALLER_ID_RELOAD_\(error.code)", error.localizedDescription)
        } else {
          promise.resolve(nil)
        }
      }
    }

    AsyncFunction("getStatus") { (promise: Promise) in
      guard let id = Self.extensionId() else {
        promise.resolve("unavailable")
        return
      }
      CXCallDirectoryManager.sharedInstance.getEnabledStatusForExtension(withIdentifier: id) { status, error in
        if error != nil {
          promise.resolve("unknown")
          return
        }
        switch status {
        case .enabled: promise.resolve("enabled")
        case .disabled: promise.resolve("disabled")
        default: promise.resolve("unknown")
        }
      }
    }

    // Открывает в Настройках iOS ту самую страницу «Блокировка и
    // идентификация вызовов» — человеку не нужно искать её самому.
    AsyncFunction("openSettings") { (promise: Promise) in
      if #available(iOS 13.4, *) {
        CXCallDirectoryManager.sharedInstance.openSettings { error in
          if let error = error {
            promise.reject("ERR_CALLER_ID_SETTINGS", error.localizedDescription)
          } else {
            promise.resolve(nil)
          }
        }
      } else {
        promise.reject("ERR_CALLER_ID_SETTINGS", "iOS 13.4 or newer is required")
      }
    }
  }

  private static func listURL() -> URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "BabunAppGroup") as? String,
          !group.isEmpty,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { return nil }
    return container.appendingPathComponent(listFileName)
  }

  private static func extensionId() -> String? {
    guard let id = Bundle.main.object(forInfoDictionaryKey: "BabunCallDirectoryExtension") as? String,
          !id.isEmpty
    else { return nil }
    return id
  }
}

final class CallerIdNotConfiguredException: Exception {
  override var reason: String {
    "Caller ID extension or App Group is not configured in this build"
  }
}
