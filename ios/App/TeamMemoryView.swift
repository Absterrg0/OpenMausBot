import CompanionCore
import SwiftUI

/// The people, places, decisions and terms every bot in a section shares.
/// Every bot proposal waits for admin review; the person answers, edits, adds, and
/// removes. The phone twin of Team map → Memory on the desktop.
struct TeamMemoryView: View {
    let section: String
    @EnvironmentObject private var session: Session
    @State private var page: TeamMemoryPage?
    @State private var loading = false
    @State private var failed = false
    @State private var busyID: String?
    @State private var adding = false
    @State private var draftKind = "term"
    @State private var draftName = ""
    @State private var draftDetail = ""
    @State private var editingEntry: TeamMemoryEntry?
    @State private var editDetail = ""
    @State private var loadGeneration = 0

    private static let kinds: [(kind: String, title: LocalizedStringKey)] = [
        ("person", "People"), ("place", "Places"), ("decision", "Decisions"), ("term", "Terms"),
    ]

    private var entries: [TeamMemoryEntry] { page?.entries ?? [] }
    private var proposed: [TeamMemoryEntry] { entries.filter { $0.status == "proposed" } }

    var body: some View {
        List {
            if !proposed.isEmpty {
                Section("Waiting for you") {
                    ForEach(proposed) { entry in
                        VStack(alignment: .leading, spacing: 6) {
                            EntryLine(entry: entry)
                            HStack {
                                Button {
                                    Task { await answer(entry, remember: true) }
                                } label: { Label("Remember", systemImage: "checkmark") }
                                .buttonStyle(.borderedProminent)
                                Button("Skip") {
                                    Task { await answer(entry, remember: false) }
                                }
                                .buttonStyle(.bordered)
                            }
                            .disabled(busyID != nil)
                        }
                    }
                }
            }
            if let page, page.entries.filter({ $0.status == "accepted" }).isEmpty, proposed.isEmpty {
                Section {
                    Text("Nothing shared yet. Every bot proposal waits for an admin's review before it is shared. Your own additions are shared immediately.")
                        .foregroundStyle(.secondary)
                }
            }
            ForEach(Self.kinds, id: \.kind) { kind in
                let rows = entries.filter { $0.status == "accepted" && $0.kind == kind.kind }
                if !rows.isEmpty {
                    Section(kind.title) {
                        ForEach(rows) { entry in
                            EntryLine(entry: entry)
                                .swipeActions(edge: .trailing) {
                                    Button {
                                        editDetail = entry.detail
                                        editingEntry = entry
                                    } label: { Label("Edit", systemImage: "pencil") }
                                    .tint(.accentColor)
                                    .disabled(busyID != nil)
                                    Button(role: .destructive) {
                                        Task { await remove(entry) }
                                    } label: {
                                        Label("Remove", systemImage: "trash")
                                    }
                                    .disabled(busyID != nil)
                                }
                        }
                    }
                }
            }
            Section {
                if adding {
                    Picker("Kind", selection: $draftKind) {
                        Text("Person").tag("person")
                        Text("Place").tag("place")
                        Text("Decision").tag("decision")
                        Text("Term").tag("term")
                    }
                    TextField("Name", text: $draftName)
                    TextField("What every bot should know about it", text: $draftDetail, axis: .vertical)
                        .lineLimit(2...4)
                    HStack {
                        Button("Add") { Task { await add() } }
                            .buttonStyle(.borderedProminent)
                            .disabled(page == nil || busyID != nil || draftName.trimmingCharacters(in: .whitespaces).isEmpty || draftDetail.trimmingCharacters(in: .whitespaces).isEmpty)
                        Button("Cancel") { adding = false }
                            .buttonStyle(.bordered)
                    }
                } else {
                    Button { adding = true } label: { Label("Add an entry", systemImage: "plus") }
                        .disabled(page == nil || busyID != nil)
                }
            }
            if failed {
                Section {
                    EmptyStateView(String(localized: "Couldn't load"), systemImage: "wifi.exclamationmark")
                }
            }
        }
        .navigationTitle(page.map { "\($0.label) team memory" } ?? "Team memory")
        .overlay { if loading && page == nil { ProgressView() } }
        .task(id: session.connection?.id) {
            page = nil
            failed = false
            busyID = nil
            editingEntry = nil
            await load()
        }
        .refreshable { await load() }
        .sheet(item: $editingEntry) { entry in
            NavigationStack {
                Form {
                    TextField("Detail", text: $editDetail, axis: .vertical)
                        .lineLimit(3...8)
                        .accessibilityLabel("Detail")
                        .accessibilityIdentifier("team-memory-detail")
                        .disabled(busyID != nil)
                }
                .navigationTitle(entry.name)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { editingEntry = nil }.disabled(busyID != nil)
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") {
                            Task {
                                let detail = editDetail.trimmingCharacters(in: .whitespacesAndNewlines)
                                if await mutate(id: entry.id, { try await $0.updateTeamMemory(section: section, id: entry.id, detail: detail) }) {
                                    editingEntry = nil
                                }
                            }
                        }
                        .disabled(busyID != nil || editDetail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    }
                }
                .interactiveDismissDisabled(busyID != nil)
            }
        }
    }

    private func load() async {
        guard busyID == nil else { return }
        loadGeneration += 1
        let generation = loadGeneration
        let connectionID = session.connection?.id
        loading = true
        defer {
            if !Task.isCancelled, session.connection?.id == connectionID, loadGeneration == generation { loading = false }
        }
        let loaded = await session.teamMemory(section: section)
        guard !Task.isCancelled, session.connection?.id == connectionID, loadGeneration == generation else { return }
        if let loaded {
            page = loaded
            failed = false
        } else {
            failed = true
        }
    }

    private func mutate(id: String, _ body: (CompanionClient) async throws -> [TeamMemoryEntry]) async -> Bool {
        guard page != nil, busyID == nil else { return false }
        let connectionID = session.connection?.id
        loadGeneration += 1
        let generation = loadGeneration
        loading = false
        busyID = id
        defer { if loadGeneration == generation { busyID = nil } }
        let result = await session.editTeamMemory(body)
        guard !Task.isCancelled, session.connection?.id == connectionID, loadGeneration == generation,
              let entries = result, var current = page else { return false }
        current.entries = entries
        page = current
        return true
    }

    private func answer(_ entry: TeamMemoryEntry, remember: Bool) async {
        _ = await mutate(id: entry.id) { try await $0.answerTeamMemory(section: section, id: entry.id, remember: remember) }
    }

    private func remove(_ entry: TeamMemoryEntry) async {
        _ = await mutate(id: entry.id) { try await $0.removeTeamMemory(section: section, id: entry.id) }
    }

    private func add() async {
        let name = draftName.trimmingCharacters(in: .whitespaces)
        let detail = draftDetail.trimmingCharacters(in: .whitespaces)
        if await mutate(id: "new", { try await $0.addTeamMemory(section: section, kind: draftKind, name: name, detail: detail) }) {
            draftName = ""
            draftDetail = ""
            adding = false
        }
    }
}

private struct EntryLine: View {
    let entry: TeamMemoryEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 4) {
                Text(entry.name).fontWeight(.medium)
                if !entry.aliases.isEmpty {
                    Text("(also \(entry.aliases.joined(separator: ", ")))")
                        .foregroundStyle(.secondary)
                }
            }
            Text(entry.detail)
            Text("\(entry.source.botName.isEmpty ? "you" : entry.source.botName) · \(Date(timeIntervalSince1970: entry.updatedAt / 1_000).formatted(date: .abbreviated, time: .omitted))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
    }
}
