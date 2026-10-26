import WidgetKit
import SwiftUI

// Ledger's "Today" widget: today's Actions, in Ledger's own Flow order, exactly as the app
// last saw them. Read-only (Phase 3): tapping an Action opens it in Ledger; tapping
// anywhere else opens Today. The snapshot is built by the web app and shared through the
// App Group (Shared/LedgerShared.swift); this file only draws it.

// MARK: - Timeline

struct TodayEntry: TimelineEntry {
    let date: Date
    let snapshot: TodaySnapshot?
}

struct TodayProvider: TimelineProvider {
    func placeholder(in context: Context) -> TodayEntry {
        TodayEntry(date: Date(), snapshot: .preview)
    }

    func getSnapshot(in context: Context, completion: @escaping (TodayEntry) -> Void) {
        completion(TodayEntry(date: Date(), snapshot: context.isPreview ? (LedgerShared.read() ?? .preview) : LedgerShared.read()))
    }

    // One entry now, and one at midnight, when today's snapshot becomes yesterday's and the
    // widget says so. The app reloads the timeline whenever Today changes.
    func getTimeline(in context: Context, completion: @escaping (Timeline<TodayEntry>) -> Void) {
        let now = Date()
        let snap = LedgerShared.read()
        var entries = [TodayEntry(date: now, snapshot: snap)]
        if let midnight = Calendar.current.nextDate(after: now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) {
            entries.append(TodayEntry(date: midnight, snapshot: snap))
        }
        completion(Timeline(entries: entries, policy: .atEnd))
    }
}

// MARK: - Ledger's palette (index.html :root, dark and light)

private extension Color {
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

private enum Palette {
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
        StaticConfiguration(kind: "LedgerToday", provider: TodayProvider()) { entry in
            TodayWidgetView(entry: entry)
                .containerBackground(Palette.ground, for: .widget)
        }
        .configurationDisplayName("Today")
        .description("Today's Actions, in your Flow order.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private let todayURL = URL(string: "\(LedgerShared.appScheme)://open?view=today")!

struct TodayWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TodayEntry

    // the snapshot only counts for the day it describes
    private var today: TodaySnapshot? {
        guard let s = entry.snapshot, s.date == LedgerShared.localDate(entry.date) else { return nil }
        return s
    }

    // a small widget is one tap: the next Action, or Today; a medium one has a link per row
    private var tapURL: URL {
        if family == .systemSmall, let next = today?.items.first(where: { $0.open }), let url = URL(string: next.link) {
            return url
        }
        return todayURL
    }

    var body: some View {
        Group {
            if let s = today {
                switch family {
                case .systemMedium: MediumView(s: s)
                default: SmallView(s: s)
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

private func meta(_ item: TodaySnapshot.Item) -> String? {
    item.time
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

// MARK: - Small: the next Action

private struct SmallView: View {
    let s: TodaySnapshot
    var body: some View {
        let next = s.items.first(where: { $0.open })
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
                    Text(next.title)
                        .font(.system(size: 16, weight: .regular, design: .serif))
                        .foregroundStyle(Palette.text)
                        .lineLimit(3)
                        .minimumScaleFactor(0.85)
                        .privacySensitive()
                    if let m = meta(next) {
                        Text(m)
                            .font(.system(size: 11).monospacedDigit())
                            .foregroundStyle(Palette.text2)
                    }
                }
            } else {
                NothingLeft(s: s)
            }
        }
    }
}

// MARK: - Medium: the count beside the next few

private struct MediumView: View {
    let s: TodaySnapshot
    private let rows = 4
    var body: some View {
        let open = s.items.filter { $0.open }
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Kicker(text: "Today")
                Text(s.dayLabel)
                    .font(.system(size: 12))
                    .foregroundStyle(Palette.text2)
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
            .frame(width: 96, alignment: .leading)

            VStack(alignment: .leading, spacing: 0) {
                if open.isEmpty {
                    Spacer(minLength: 0)
                    NothingLeft(s: s)
                    Spacer(minLength: 0)
                } else {
                    ForEach(Array(open.prefix(rows).enumerated()), id: \.element.id) { i, item in
                        Link(destination: URL(string: item.link) ?? todayURL) {
                            ActionRow(item: item, first: i == 0)
                        }
                        if i < min(open.count, rows) - 1 { Divider().overlay(Palette.track) }
                    }
                    Spacer(minLength: 0)
                    if open.count > rows {
                        Text("+\(open.count - rows) more")
                            .font(.system(size: 11))
                            .foregroundStyle(Palette.text3)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ActionRow: View {
    let item: TodaySnapshot.Item
    let first: Bool
    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Palette.category(item.category))
                .frame(width: 7, height: 7)
            Text(item.title)
                .font(.system(size: 13, weight: first ? .medium : .regular))
                .foregroundStyle(Palette.text)
                .lineLimit(1)
                .privacySensitive()
            Spacer(minLength: 4)
            if let t = item.time {
                Text(t)
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(Palette.text2)
            }
        }
        .padding(.vertical, 6)
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
        return TodaySnapshot(v: 1, date: today, dayLabel: "Today", total: 6, done: 2, items: [
            item("a", "Morning walk", "07:30", "training", done: true),
            item("b", "Reply to the accountant", nil, "work", done: true),
            item("c", "Finish the quarterly plan", "10:00", "work"),
            item("d", "Call Mum", nil, "family"),
            item("e", "Book the plumber", "14:00", "personal"),
            item("f", "Padel", "18:30", "training")
        ], generatedAt: nil)
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
