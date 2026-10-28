import Foundation

/// What Ledger's app and its widgets share: the App Group, and the Today snapshot the web
/// app builds (index.html, `buildWidgetSnapshot`). The app writes it; the widget only
/// reads and draws it. No Ledger logic lives on this side.
enum LedgerShared {
    static let appGroup = "group.luxe.sgj.ledger"
    static let appScheme = "luxe.sgj.ledger"
    private static let fileName = "today-widget.json"

    /// nil when the App Group isn't available (e.g. a build signed without it)
    static var fileURL: URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
            .appendingPathComponent(fileName)
    }

    /// Readable once the phone has been unlocked after a restart, so the widget can draw
    /// on the Home Screen and Lock Screen.
    @discardableResult
    static func write(_ data: Data) -> Bool {
        guard let url = fileURL else { return false }
        do {
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            return true
        } catch {
            return false
        }
    }

    static func clear() {
        guard let url = fileURL else { return }
        try? FileManager.default.removeItem(at: url)
    }

    static func read() -> TodaySnapshot? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(TodaySnapshot.self, from: data)
    }

    /// The device's own date, as the web app writes it (YYYY-MM-DD, local time).
    static func localDate(_ date: Date = Date()) -> String {
        let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }
}

/// The snapshot (docs/NATIVE_MIGRATION.md §4.1). Version 2 adds Morning Prime (while it's
/// not done), today's exercise and Communications counts; version 3 the Current Focus;
/// version 4 key tasks (`Item.key`) and the whole Flow (`flow`), for the Flow widget.
/// All optional, so either side reads the other's older snapshots.
struct TodaySnapshot: Codable, Equatable {
    struct Item: Codable, Identifiable, Equatable {
        let id: String
        let title: String
        let time: String?        // "HH:MM" or nil
        let category: String?
        let done: Bool
        let open: Bool           // planned or partly done: still to do
        let link: String         // luxe.sgj.ledger://open?openAction=…
        var key: Bool? = nil     // a key task (version 4)
    }
    /// One step of today's Flow, in Flow order: an Action, planned training or a Reset Sprint.
    struct FlowItem: Codable, Equatable {
        let kind: String         // "action", "training" or "sprint"
        let id: String
        let title: String
        let time: String?        // "HH:MM" when it has a time
        let end: String?         // "HH:MM" when it also has a length
        let done: Bool
        let key: Bool?           // a key task
        let category: String?
        let link: String         // an Action opens itself; anything else opens Flow
    }
    struct Prime: Codable, Equatable {
        let label: String        // "Plan ✓ · Move 2/5"
        let short: String?       // "P ✓ M 2/5", beside the name on a row (version 3)
    }
    struct Focus: Codable, Equatable {
        let title: String        // what Shaun is focusing on now
        let context: String?     // "Action · 10:00", "Reset sprint · Inbox zero"
        let setAt: String?       // ISO 8601, when it was set
        let link: String         // opens it in Ledger
        var endsAt: String? = nil // ISO 8601, when its timer ends (a timer is optional)
    }
    struct Exercise: Codable, Equatable {
        let title: String        // "Strength", "Padel", "Rest day"
        let done: Bool
    }
    struct Comms: Codable, Equatable {
        let needs: Int           // conversations waiting on you
        let due: Int             // follow-ups due
        let waiting: Int         // waiting on someone else
    }
    let v: Int
    let date: String             // the day it describes, YYYY-MM-DD
    let dayLabel: String
    let total: Int
    let done: Int
    let items: [Item]
    let generatedAt: String?
    let prime: Prime?            // nil once it's done (or there's no Morning Prime)
    let exercise: [Exercise]?
    let comms: Comms?            // counts only, never names
    let focus: Focus?            // the Current Focus, if one is set and still live
    var flow: [FlowItem]? = nil  // today's Flow, done steps included (version 4)
}
