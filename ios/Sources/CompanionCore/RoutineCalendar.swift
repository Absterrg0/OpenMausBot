// The routine calendar's arithmetic: which runs land on a day.
//
// A port of `projectedRoutineItems` in src/lib/routine-calendar.ts, so the
// phone and the desktop put the same work on the same day. Past and active
// runs come from their receipts; upcoming ones are projected from each
// enabled routine's schedule, and a receipt always replaces its projection.
//
// Daily times are read in this device's timezone, as the desktop reads them
// in its own: the two agree whenever the phone and its computer do.
import Foundation

public struct RoutineCalendarItem: Identifiable, Hashable, Sendable {
    public let id: String
    /// Milliseconds since 1970, like every timestamp on the wire.
    public let at: Double
    /// Nil for a receipt whose routine has since been deleted.
    public let routine: Routine?
    /// The run that happened or is happening; nil for an upcoming one.
    public let run: RoutineRun?

    public var date: Date { Date(timeIntervalSince1970: at / 1_000) }
}

public enum RoutineCalendar {
    /// A routine that runs every few minutes would bury a day in receipts.
    /// Keep the newest dozen finished runs per routine; active ones always show.
    static let maxReceiptsPerRoutine = 12

    /// The seven days of the week holding `date`, Monday first, as the
    /// desktop's calendar lays them out.
    public static func week(containing date: Date, calendar: Calendar = .current) -> [Date] {
        let day = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: day) // 1 = Sunday
        let monday = calendar.date(byAdding: .day, value: -((weekday + 5) % 7), to: day) ?? day
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: monday) }
    }

    /// Everything on one day, in time order.
    public static func items(
        routines: [Routine],
        runs: [RoutineRun],
        day: Date,
        calendar: Calendar = .current
    ) -> [RoutineCalendarItem] {
        let start = calendar.startOfDay(for: day)
        let end = calendar.date(byAdding: .day, value: 1, to: start) ?? start.addingTimeInterval(86_400)
        let from = start.timeIntervalSince1970 * 1_000
        let to = end.timeIntervalSince1970 * 1_000
        let routineById = Dictionary(routines.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })

        var receiptCounts: [String: Int] = [:]
        let visibleRuns = runs
            .filter { $0.scheduledFor >= from && $0.scheduledFor < to }
            .sorted { $0.scheduledFor > $1.scheduledFor }
            .filter { run in
                if ["queued", "running", "waiting"].contains(run.status) { return true }
                // A routine may since have been edited or deleted, so its
                // current definition cannot say whether this history came
                // from a dense interval. Trim terminal history instead.
                let count = receiptCounts[run.routineId, default: 0]
                guard count < maxReceiptsPerRoutine else { return false }
                receiptCounts[run.routineId] = count + 1
                return true
            }
        var items = visibleRuns.map { run in
            RoutineCalendarItem(id: "run-\(run.id)", at: run.scheduledFor, routine: routineById[run.routineId], run: run)
        }

        func hasReceipt(_ routineId: String, _ at: Double) -> Bool {
            runs.contains { $0.routineId == routineId && abs($0.scheduledFor - at) < 60_000 }
        }
        func project(_ routine: Routine, _ at: Double) {
            guard at >= from, at < to, !hasReceipt(routine.id, at) else { return }
            items.append(RoutineCalendarItem(id: "next-\(routine.id)-\(Int64(at))", at: at, routine: routine, run: nil))
        }

        for routine in routines where routine.enabled {
            switch routine.schedule.type {
            case .once:
                if let at = routine.schedule.at { project(routine, at) }
            case .daily:
                guard let time = routine.schedule.time, let weekdays = routine.schedule.weekdays,
                      let at = localTime(time, on: start, calendar: calendar)
                else { continue }
                // The wire numbers weekdays as JavaScript does: 0 = Sunday.
                let weekday = calendar.component(.weekday, from: start) - 1
                guard weekdays.contains(weekday), at >= routine.createdAt else { continue }
                project(routine, at)
            case .interval, .unknown:
                // The scheduler skips overlapping and stale ticks, so its
                // persisted next run is the only future occurrence to show;
                // reconstructing others would resurrect skipped work. A
                // schedule from a newer desktop (cron) is read the same way.
                if let at = routine.nextRunAt { project(routine, at) }
            }
        }
        return items.sorted { $0.at < $1.at }
    }

    /// "HH:mm" on `day`, in milliseconds.
    static func localTime(_ time: String, on day: Date, calendar: Calendar) -> Double? {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2, (0..<24).contains(parts[0]), (0..<60).contains(parts[1]),
              let date = calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: day)
        else { return nil }
        return date.timeIntervalSince1970 * 1_000
    }
}
