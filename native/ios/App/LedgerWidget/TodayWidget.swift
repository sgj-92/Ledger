import WidgetKit
import SwiftUI
import AppIntents

// Ledger's "Today" widget: today's Actions, in Ledger's own Flow order, exactly as the app
// last saw them. Above them, if you like (Edit Widget): Morning Prime while it isn't done,
// and today's exercise. Below them, Communications as counts. Read-only: tapping an Action
// opens it in Ledger; tapping the Communications line opens Communications; anywhere else
// opens Today. The snapshot is built by the web app and shared through the App Group
// (Shared/LedgerShared.swift); this file only draws it.

// MARK: - What it shows (long-press → Edit Widget)

struct TodayWidgetIntent: WidgetConfigurationIntent {
    static let title: LocalizedStringResource = "Today"
    static let description = IntentDescription("Today's Actions, and what else to show with them.")

    @Parameter(title: "Morning Prime, until it's done", default: true)
    var showPrime: Bool

    @Parameter(title: "Exercise", default: true)
    var showExercise: Bool

    @Parameter(title: "Communications", default: true)
    var showComms: Bool
}

// MARK: - Timeline

struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: TodaySnapshot?
    var showPrime = true
    var showExercise = true
    var showComms = true
}

struct TodayProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), snapshot: .preview)
    }

    func snapshot(for configuration: TodayWidgetIntent, in context: Context) async -> TodayEntry {
        entry(Date(), context.isPreview ? (LedgerShared.read() ?? .preview) : LedgerShared.read(), configuration)
    }

    // One entry now, and one at midnight, when today's snapshot becomes yesterday's and the
    // widget says so. The app reloads the timeline whenever Today changes.
    func timeline(for configuration: TodayWidgetIntent, in context: Context) async -> Timeline<TodayEntry> {
        let now = Date()
        let snap = LedgerShared.read()
        var entries = [entry(now, snap, configuration)]
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) {
            entries.append(entry(midnight, snap, configuration))
        }
        return Timeline(entries: entries, policy: .atEnd)
    }

    private func entry(_ date: Date, _ snapshot: TodaySnapshot?, _ c: TodayWidgetIntent) -> TodayEntry {
        TodayEntry(date: date, snapshot: snapshot, showPrime: c.showPrime, showExercise: c.showExercise, showComms: c.showComms)
    }
}

// MARK: - Ledger's palette (index.html :root, dark and light); the Focus widget uses it too

extension Color {
    init(hex: UInt32) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: 1)
    }
    static func ledger(_ dark: UInt32, _ light: UInt32) -> Color {
        Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(Color(hex: dark)) : UIColor(Color(hex: light)) })
    }
}

enum Palette {
    static let ground = Color.ledger(0x0E0B08, 0xF2EADD)
    static let text = Color.ledger(0xF0E9DD, 0x261D16)
    static let text2 = Color.ledger(0xA89B88, 0x5A4D3E)
    static let text3 = Color.ledger(0x766A5B, 0x73624D)
    static let gold = Color.ledger(0xDCB878, 0x866325)
    static let track = Color.ledger(0x241D16, 0xE2D7C4)

    // the categories' colours (QUICK_CAPTURE_CATEGORIES)
    static func category(_ key: String?) -> Color {
        switch key {
        case "success": return .ledger(0x7AA561, 0x4F7A39)
        case "work": return .ledger(0x7D93A6, 0x566E80)
        case "communicate": return .ledger(0x5B978F, 0x3D7169)
        case "family": return .ledger(0x96849A, 0x6F5C74)
        case "personal": return .ledger(0xBB7B83, 0x96545C)
        case "training": return .ledger(0xBF9A6A, 0x92693A)
        default: return text3
        }
    }
}

// MARK: - The widget

struct TodayWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "LedgerToday", intent: TodayWidgetIntent.self, provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
                .containerBackground(Palette.ground, for: .widget)
        }
        .configurationDisplayName("Today")
        .description("Today's Actions in your Flow order, with Morning Prime, exercise and communications if you like.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private let todayURL = URL(string: "\(LedgerShared.appScheme)://open?view=today")!
private let commsURL = URL(string: "\(LedgerShared.appScheme)://open?view=comms")!

// One line of the list: Morning Prime, an exercise, or an Action
private enum Row: Identifiable {
    case prime(String)
    case exercise(TodaySnapshot.Exercise, Int)
    case action(TodaySnapshot.Item)

    var id: String {
        switch self {
        case .prime: return "prime"
        case .exercise(_, let i): return "exercise-\(i)"
        case .action(let item): return "action-\(item.id)"
        }
    }
    var link: URL {
        if case .action(let item) = self, let url = URL(string: item.link) { return url }
        return todayURL
    }
}

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    // the snapshot only counts for the day it describes
    private var today: TodaySnapshot? {
        guard let s = entry.snapshot, s.date == LedgerShared.localDate(entry.date) else { return nil }
        return s
    }

    // what to list, in order: Morning Prime (until it's done), exercise, then open Actions
    private func rows(_ s: TodaySnapshot) -> [Row] {
        var out: [Row] = []
        // the row keeps the whole name, so its counts are the short form ("P 0/4 M 0/5")
        if entry.showPrime, let p = s.prime { out.append(.prime(p.short ?? p.label)) }
        if entry.showExercise, let ex = s.exercise {
            for (i, e) in ex.enumerated() { out.append(.exercise(e, i)) }
        }
        for item in s.items where item.open { out.append(.action(item)) }
        return out
    }

    private func comms(_ s: TodaySnapshot) -> TodaySnapshot.Comms? {
        guard entry.showComms, let c = s.comms, !commsText(c).isEmpty else { return nil }
        return c
    }

    // a small widget is one tap: what's next, or Today
    private var tapURL: URL {
        if family == .systemSmall, let s = today, let next = rows(s).first(where: { if case .exercise(let e, _) = $0 { return !e.done }; return true }) {
            return next.link
        }
        return todayURL
    }

    var body: some View {
        Group {
            if let s = today {
                switch family {
                case .systemLarge: ListView(s: s, rows: rows(s), comms: comms(s), limit: 9, lines: 2)
                case .systemMedium: ListView(s: s, rows: rows(s), comms: comms(s), limit: comms(s) == nil ? 4 : 3, lines: 1)
                default: SmallView(s: s, rows: rows(s), comms: comms(s))
                }
            } else {
                OpenLedgerView(signedOut: entry.snapshot == nil)
            }
        }
        .widgetURL(tapURL)
    }
}

// MARK: - Pieces

private struct Kicker: View {
    let text: String
    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 10, weight: .medium))
            .tracking(1.6)
            .foregroundStyle(Palette.text3)
    }
}

private struct Progress: View {
    let done: Int
    let total: Int
    var body: some View {
        GeometryReader { g in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.track)
                Capsule().fill(Palette.gold)
                    .frame(width: total > 0 ? max(4, g.size.width * CGFloat(done) / CGFloat(total)) : 0)
                    .widgetAccentable()
            }
        }
        .frame(height: 4)
    }
}

// "2 need you · 1 due" — counts only, as Today shows them
private func commsText(_ c: TodaySnapshot.Comms) -> String {
    var bits: [String] = []
    if c.needs > 0 { bits.append("\(c.needs) need\(c.needs == 1 ? "s" : "") you") }
    if c.due > 0 { bits.append("\(c.due) due") }
    if bits.isEmpty && c.waiting > 0 { bits.append("\(c.waiting) waiting") }
    return bits.joined(separator: " · ")
}

private struct CommsLine: View {
    let c: TodaySnapshot.Comms
    var body: some View {
        Link(destination: commsURL) {
            HStack(spacing: 6) {
                Image(systemName: "bubble.left.and.bubble.right")
                    .font(.system(size: 10))
                    .foregroundStyle(Palette.text3)
                    .frame(width: 12)
                Text("Comms · " + commsText(c))
                    .font(.system(size: 11, weight: c.needs > 0 ? .medium : .regular))
                    .foregroundStyle(c.needs > 0 ? Palette.gold : Palette.text2)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

private struct RowView: View {
    let row: Row
    let first: Bool
    let lines: Int

    private var title: String {
        switch row {
        case .prime: return "Morning Prime"
        case .exercise(let e, _): return e.title
        case .action(let item): return item.title
        }
    }
    private var trailing: String? {
        switch row {
        case .prime(let label): return label
        case .exercise(let e, _): return e.done ? "Done" : "Planned"
        case .action(let item): return item.time
        }
    }
    private var quiet: Bool {
        if case .exercise(let e, _) = row { return e.done }
        return false
    }
    // a key task wears its gold star, as it does in Ledger
    private var isKey: Bool {
        if case .action(let item) = row { return item.key == true }
        return false
    }

    var body: some View {
        HStack(spacing: 8) {
            mark.frame(width: 12)
            if isKey {
                Image(systemName: "star.fill")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(Palette.gold)
                    .widgetAccentable()
            }
            // the title takes all the width there is: only the time beside it keeps its size
            Text(title)
                .font(.system(size: 13, weight: first ? .medium : .regular))
                .foregroundStyle(quiet ? Palette.text2 : Palette.text)
                .lineLimit(lines)
                .multilineTextAlignment(.leading)
                .frame(maxWidth: .infinity, alignment: .leading)
                .layoutPriority(1)
                .privacySensitive()
            if let t = trailing {
                Text(t)
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(Palette.text2)
                    .lineLimit(1)
                    .fixedSize()
            }
        }
        .padding(.vertical, lines > 1 ? 5 : 6)
    }

    @ViewBuilder private var mark: some View {
        switch row {
        case .prime:
            Image(systemName: "sunrise")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(Palette.gold)
                .widgetAccentable()
        case .exercise(let e, _):
            Image(systemName: e.done ? "checkmark" : "figure.run")
                .font(.system(size: 10, weight: .medium))
                .foregroundStyle(e.done ? Palette.text3 : Palette.category("training"))
        case .action(let item):
            Circle()
                .fill(Palette.category(item.category))
                .frame(width: 7, height: 7)
        }
    }
}

private struct NothingLeft: View {
    let s: TodaySnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if s.total == 0 {
                Text("Nothing planned")
                    .font(.system(.title3, design: .serif))
                    .foregroundStyle(Palette.text)
                Text("Open Ledger to plan today")
                    .font(.caption)
                    .foregroundStyle(Palette.text2)
            } else {
                Image(systemName: "checkmark.circle.fill")
                    .font(.title2)
                    .foregroundStyle(Palette.gold)
                    .widgetAccentable()
                Text("All done")
                    .font(.system(.title3, design: .serif))
                    .foregroundStyle(Palette.text)
            }
        }
    }
}

// MARK: - Small: what's next

private struct SmallView: View {
    let s: TodaySnapshot
    let rows: [Row]
    let comms: TodaySnapshot.Comms?
    var body: some View {
        // an exercise already done isn't "next"
        let next = rows.first(where: { if case .exercise(let e, _) = $0 { return !e.done }; return true })
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Kicker(text: "Today")
                Spacer()
                Text("\(s.done)/\(s.total)")
                    .font(.system(size: 12, weight: .medium).monospacedDigit())
                    .foregroundStyle(Palette.text2)
            }
            Progress(done: s.done, total: s.total)
            Spacer(minLength: 0)
            if let next = next {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Next")
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(Palette.gold)
                    Text(nextTitle(next))
                        .font(.system(size: 16, weight: .regular, design: .serif))
                        .foregroundStyle(Palette.text)
                        .lineLimit(3)
                        .minimumScaleFactor(0.85)
                        .privacySensitive()
                    if let m = nextMeta(next) {
                        Text(m)
                            .font(.system(size: 11).monospacedDigit())
                            .foregroundStyle(Palette.text2)
                            .lineLimit(1)
                    }
                }
            } else {
                NothingLeft(s: s)
            }
            if let c = comms {
                Text(commsText(c))
                    .font(.system(size: 11, weight: c.needs > 0 ? .medium : .regular))
                    .foregroundStyle(c.needs > 0 ? Palette.gold : Palette.text2)
                    .lineLimit(1)
            }
        }
    }

    private func nextTitle(_ row: Row) -> String {
        switch row {
        case .prime: return "Morning Prime"
        case .exercise(let e, _): return e.title
        case .action(let item): return item.title
        }
    }
    private func nextMeta(_ row: Row) -> String? {
        switch row {
        case .prime(let label): return label
        case .exercise: return "Exercise"
        case .action(let item): return item.time
        }
    }
}

// MARK: - Medium and large: the count beside the list

private struct ListView: View {
    let s: TodaySnapshot
    let rows: [Row]
    let comms: TodaySnapshot.Comms?
    let limit: Int
    let lines: Int

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Kicker(text: "Today")
                Text(s.dayLabel)
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.text2)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Text("\(s.done)")
                    .font(.system(size: 34, weight: .regular, design: .serif).monospacedDigit())
                    .foregroundStyle(Palette.text)
                + Text(" of \(s.total)")
                    .font(.system(size: 15, design: .serif))
                    .foregroundStyle(Palette.text2)
                Progress(done: s.done, total: s.total)
                Text("done")
                    .font(.system(size: 11))
                    .foregroundStyle(Palette.text3)
            }
            .frame(width: 84, alignment: .leading)

            VStack(alignment: .leading, spacing: 0) {
                if rows.isEmpty {
                    Spacer(minLength: 0)
                    NothingLeft(s: s)
                    Spacer(minLength: 0)
                } else {
                    let shown = Array(rows.prefix(limit))
                    ForEach(Array(shown.enumerated()), id: \.element.id) { i, row in
                        Link(destination: row.link) {
                            RowView(row: row, first: i == 0, lines: lines)
                        }
                        if i < shown.count - 1 { Divider().overlay(Palette.track) }
                    }
                    Spacer(minLength: 0)
                    if rows.count > limit {
                        Text("+\(rows.count - limit) more")
                            .font(.system(size: 11))
                            .foregroundStyle(Palette.text3)
                    }
                }
                if let c = comms {
                    CommsLine(c: c)
                        .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

// MARK: - No snapshot for today yet

private struct OpenLedgerView: View {
    let signedOut: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Kicker(text: "Ledger")
            Spacer(minLength: 0)
            Text(signedOut ? "Sign in to Ledger" : "Open Ledger")
                .font(.system(.title3, design: .serif))
                .foregroundStyle(Palette.text)
            Text(signedOut ? "Your day appears here" : "to see today")
                .font(.caption)
                .foregroundStyle(Palette.text2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Previews and the gallery

extension TodaySnapshot {
    static var preview: TodaySnapshot {
        let today = LedgerShared.localDate()
        func item(_ id: String, _ title: String, _ time: String?, _ cat: String, done: Bool = false) -> Item {
            Item(id: id, title: title, time: time, category: cat, done: done, open: !done, link: "\(LedgerShared.appScheme)://open?openAction=\(id)")
        }
        func step(_ kind: String, _ id: String, _ title: String, _ time: String?, _ end: String?, _ cat: String?, done: Bool = false, key: Bool = false) -> FlowItem {
            FlowItem(kind: kind, id: id, title: title, time: time, end: end, done: done, key: key, category: cat,
                     link: kind == "action" ? "\(LedgerShared.appScheme)://open?openAction=\(id)" : "\(LedgerShared.appScheme)://open?view=today&mode=flow")
        }
        var keyTask = item("c", "Finish the quarterly plan for the board", "10:00", "work")
        keyTask.key = true
        return TodaySnapshot(v: 4, date: today, dayLabel: "Today", total: 6, done: 2, items: [
            item("a", "Morning walk", "07:30", "training", done: true),
            item("b", "Reply to the accountant", nil, "work", done: true),
            keyTask,
            item("d", "Call Mum", nil, "family"),
            item("e", "Book the plumber", "14:00", "personal"),
            item("f", "Padel", "18:30", "training")
        ], generatedAt: nil,
        prime: Prime(label: "Plan ✓ · Move 2/5", short: "P ✓ M 2/5"),
        exercise: [Exercise(title: "Strength", done: false)],
        comms: Comms(needs: 2, due: 1, waiting: 3),
        focus: Focus(title: "Finish the quarterly plan for the board", context: "Action · 10:00",
                     setAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-1500)),
                     link: "\(LedgerShared.appScheme)://open?openAction=c"),
        flow: [
            step("sprint", "s", "Reset sprint", "07:41", "08:09", nil, done: true),
            step("action", "b", "Reply to the accountant", nil, nil, "work", done: true),
            step("training", "resistance", "Strength", "09:30", "10:30", "training"),
            step("action", "c", "Finish the quarterly plan for the board", nil, nil, "work", key: true),
            step("action", "d", "Call Mum", nil, nil, "family"),
            step("action", "e", "Book the plumber", "14:00", nil, "personal")
        ])
    }
}

#Preview(as: .systemSmall) {
    TodayWidget()
} timeline: {
    TodayEntry(date: .now, snapshot: .preview)
}

#Preview(as: .systemMedium) {
    TodayWidget()
} timeline: {
    TodayEntry(date: .now, snapshot: .preview)
}

#Preview(as: .systemLarge) {
    TodayWidget()
} timeline: {
    TodayEntry(date: .now, snapshot: .preview)
}
