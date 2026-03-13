import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  type DataStore,
  dataStoreSchema,
  type FeedbackEvent,
  type MessageEntry,
  messageSchema,
  type PendingShadowTurn,
  type PerceptionObservation,
  type Persona,
  personaSchema,
} from "@/lib/types";
import {
  createInitialMindState,
  createPersonalityConstitution,
  createRelationshipModel,
} from "@/lib/mind-runtime";
import { houseVoicePresets } from "@/lib/voice-presets";
import { slugify } from "@/lib/utils";

const storeFile = process.env.PERSONA_STORE_FILE ?? path.join(process.cwd(), "data", "demo-store.json");
const uploadsDir =
  process.env.PERSONA_UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");

let pendingWrite = Promise.resolve();

const seededHouseVoiceMap = {
  "persona-mom": houseVoicePresets[0].id,
  "persona-alex": houseVoicePresets[1].id,
} as const;

function isHydratedPersonalityConstitution(
  value: unknown,
): value is Persona["personalityConstitution"] {
  return typeof value === "object" && value !== null && "warmth" in value && "directness" in value;
}

function isHydratedRelationshipModel(value: unknown): value is Persona["relationshipModel"] {
  return typeof value === "object" && value !== null && "closeness" in value && "baselineTone" in value;
}

function createSeedStore(): DataStore {
  const now = new Date();
  const iso = (offsetHours: number) =>
    new Date(now.getTime() + offsetHours * 60 * 60 * 1000).toISOString();
  const humeConfigured = Boolean(process.env.HUME_API_KEY?.trim());
  const momVoice = humeConfigured
    ? {
        provider: "hume" as const,
        voiceId: houseVoicePresets[0].id,
        status: "preview_only" as const,
        cloneState: "none" as const,
        watermarkApplied: false,
      }
    : {
        provider: "mock" as const,
        voiceId: "mock-mom",
        status: "preview_only" as const,
        cloneState: "none" as const,
        watermarkApplied: false,
      };
  const alexVoice = humeConfigured
    ? {
        provider: "hume" as const,
        voiceId: houseVoicePresets[1].id,
        status: "preview_only" as const,
        cloneState: "none" as const,
        watermarkApplied: false,
      }
    : {
        provider: "mock" as const,
        voiceId: "mock-alex",
        status: "preview_only" as const,
        cloneState: "none" as const,
        watermarkApplied: false,
      };
  const momHeartbeatPolicy = {
    enabled: true,
    intervalHours: 4,
    maxOutboundPerDay: 3,
    quietHoursStart: 22,
    quietHoursEnd: 8,
    preferredMode: "mixed" as const,
    workHoursEnabled: false,
    workHoursStart: 9,
    workHoursEnd: 17,
    workDays: [1, 2, 3, 4, 5],
    boundaryNotes: [],
  };
  const alexHeartbeatPolicy = {
    enabled: true,
    intervalHours: 4,
    maxOutboundPerDay: 3,
    quietHoursStart: 23,
    quietHoursEnd: 8,
    preferredMode: "text" as const,
    workHoursEnabled: false,
    workHoursStart: 9,
    workHoursEnd: 17,
    workDays: [1, 2, 3, 4, 5],
    boundaryNotes: [],
  };
  const momDossier = {
    essence: "A reassuring morning texter who leads with care and encouragement.",
    communicationStyle: "Short, warm, punctuation-heavy, and grounding.",
    signaturePhrases: ["sweetie", "honey", "love you"],
    favoriteTopics: ["family", "big life updates", "daily check-ins"],
    emotionalTendencies: ["protective", "optimistic", "deeply proud"],
    routines: ["good-morning check-ins", "follows up after stressful events"],
    guidance: ["Keep warmth first.", "Prefer one concrete follow-up question."],
    sourceSummary:
      "Derived from short loving texts, interview notes, and a demo voice profile.",
  };
  const alexDossier = {
    essence: "A low-drama, loyal older brother with affectionate sarcasm.",
    communicationStyle: "Brief, lowercase, lightly teasing, emotionally economical.",
    signaturePhrases: ["lmao", "you got this", "don't overthink it"],
    favoriteTopics: ["sports", "music", "family updates"],
    emotionalTendencies: ["guarded", "supportive", "observant"],
    routines: ["checks in after big events", "keeps messages short"],
    guidance: ["Use humor sparingly.", "Keep messages brief."],
    sourceSummary: "Pending manual review because the persona source is deceased.",
  };
  const messages: MessageEntry[] = [
    {
      id: "msg-1",
      personaId: "persona-mom",
      role: "assistant",
      kind: "preview",
      channel: "heartbeat",
      body: "good morning sweetie. thinking about you today. how's the interview prep going?",
      attachments: [],
      createdAt: iso(-6),
      audioStatus: "text_fallback",
      replyMode: "text",
      delivery: {
        webInbox: true,
        telegramStatus: "not_requested",
        attempts: 0,
      },
    },
    {
      id: "msg-2",
      personaId: "persona-mom",
      role: "user",
      kind: "text",
      channel: "web",
      body: "I have the interview in an hour and I'm nervous.",
      attachments: [],
      createdAt: iso(-2.5),
      audioStatus: "unavailable",
      delivery: {
        webInbox: true,
        telegramStatus: "not_requested",
        attempts: 0,
      },
    },
    {
      id: "msg-3",
      personaId: "persona-mom",
      role: "assistant",
      kind: "text",
      channel: "web",
      body: "oh honey, nerves mean you care. breathe, keep your shoulders down, and answer like you already belong there.",
      attachments: [],
      createdAt: iso(-2),
      audioStatus: "text_fallback",
      replyMode: "voice_note",
      delivery: {
        webInbox: true,
        telegramStatus: "not_requested",
        attempts: 0,
      },
    },
  ];
  const momPreferenceSignals: Persona["preferenceSignals"] = [];
  const alexPreferenceSignals: Persona["preferenceSignals"] = [];
  const momPersonalityConstitution = createPersonalityConstitution({
    name: "Mom",
    relationship: "Mother",
    source: "living",
    description:
      "Supportive, affectionate, lightly teasing, checks in around milestones and mornings.",
    dossier: momDossier,
    heartbeatPolicy: momHeartbeatPolicy,
    preferenceSignals: momPreferenceSignals,
  });
  const momRelationshipModel = createRelationshipModel({
    name: "Mom",
    relationship: "Mother",
    source: "living",
    description:
      "Supportive, affectionate, lightly teasing, checks in around milestones and mornings.",
    dossier: momDossier,
    heartbeatPolicy: momHeartbeatPolicy,
    preferenceSignals: momPreferenceSignals,
    personalityConstitution: momPersonalityConstitution,
  });
  const alexPersonalityConstitution = createPersonalityConstitution({
    name: "Alex Rivera",
    relationship: "Older brother",
    source: "deceased",
    description:
      "Dry humor, sports references, short responses, affectionate beneath the sarcasm.",
    dossier: alexDossier,
    heartbeatPolicy: alexHeartbeatPolicy,
    preferenceSignals: alexPreferenceSignals,
  });
  const alexRelationshipModel = createRelationshipModel({
    name: "Alex Rivera",
    relationship: "Older brother",
    source: "deceased",
    description:
      "Dry humor, sports references, short responses, affectionate beneath the sarcasm.",
    dossier: alexDossier,
    heartbeatPolicy: alexHeartbeatPolicy,
    preferenceSignals: alexPreferenceSignals,
    personalityConstitution: alexPersonalityConstitution,
  });
  const momMindState = createInitialMindState({
    persona: {
      name: "Mom",
      relationship: "Mother",
      source: "living",
      description:
        "Supportive, affectionate, lightly teasing, checks in around milestones and mornings.",
      dossier: momDossier,
      heartbeatPolicy: momHeartbeatPolicy,
      preferenceSignals: momPreferenceSignals,
      personalityConstitution: momPersonalityConstitution,
      relationshipModel: momRelationshipModel,
    },
    messages: messages.filter((message) => message.personaId === "persona-mom"),
  });
  const alexMindState = createInitialMindState({
    persona: {
      name: "Alex Rivera",
      relationship: "Older brother",
      source: "deceased",
      description:
        "Dry humor, sports references, short responses, affectionate beneath the sarcasm.",
      dossier: alexDossier,
      heartbeatPolicy: alexHeartbeatPolicy,
      preferenceSignals: alexPreferenceSignals,
      personalityConstitution: alexPersonalityConstitution,
      relationshipModel: alexRelationshipModel,
    },
    messages: [],
  });

  return {
    users: [
      {
        id: "user-demo",
        name: "Demo Workspace",
        createdAt: iso(-72),
      },
    ],
    personas: [
      {
        id: "persona-mom",
        userId: "user-demo",
        name: "Mom",
        relationship: "Mother",
        source: "living",
        description:
          "Supportive, affectionate, lightly teasing, checks in around milestones and mornings.",
        status: "active",
        avatarUrl: "/uploads/demo-mom-avatar.png",
        createdAt: iso(-48),
        updatedAt: iso(-2),
        lastActiveAt: iso(-2),
        lastHeartbeatAt: iso(-6),
        telegramChatId: undefined,
        telegramUsername: undefined,
        pastedText:
          "good luck today sweetie!! you're going to do amazing. call me after, okay? love you.",
        screenshotSummaries: [
          "Frequent double exclamation marks, affectionate words, concise check-ins, signs off with love.",
        ],
        interviewAnswers: {
          "How would they react to good news?": "Immediately warm, emotional, and proud.",
          "What phrases or sayings did they use often?": "sweetie, honey, i'm proud of you",
        },
        heartbeatPolicy: momHeartbeatPolicy,
        voice: momVoice,
        consent: {
          attestedRights: true,
          deceasedDisclosureAccepted: false,
          manualReviewRequired: false,
          createdAt: iso(-48),
        },
        dossier: momDossier,
        voiceSamples: [],
        screenshots: [],
        preferenceSignals: momPreferenceSignals,
        personalityConstitution: momPersonalityConstitution,
        relationshipModel: momRelationshipModel,
        mindState: momMindState,
        revision: 1,
      },
      {
        id: "persona-alex",
        userId: "user-demo",
        name: "Alex Rivera",
        relationship: "Older brother",
        source: "deceased",
        description:
          "Dry humor, sports references, short responses, affectionate beneath the sarcasm.",
        status: "pending_review",
        avatarUrl: undefined,
        createdAt: iso(-12),
        updatedAt: iso(-12),
        lastActiveAt: undefined,
        lastHeartbeatAt: undefined,
        telegramChatId: undefined,
        telegramUsername: undefined,
        pastedText: "lmao. you got this. don't overthink it.",
        screenshotSummaries: ["Uses clipped messages, lowercase, and quick sarcastic reassurance."],
        interviewAnswers: {
          "What topics lit them up immediately?": "Basketball, music, and family gossip.",
        },
        heartbeatPolicy: alexHeartbeatPolicy,
        voice: alexVoice,
        consent: {
          attestedRights: true,
          deceasedDisclosureAccepted: true,
          manualReviewRequired: true,
          createdAt: iso(-12),
        },
        dossier: alexDossier,
        voiceSamples: [],
        screenshots: [],
        preferenceSignals: alexPreferenceSignals,
        personalityConstitution: alexPersonalityConstitution,
        relationshipModel: alexRelationshipModel,
        mindState: alexMindState,
        revision: 1,
      },
    ],
    messages,
    perceptionObservations: [],
    feedbackEvents: [],
    processedTelegramUpdates: [],
  };
}

async function ensureStore() {
  const directory = path.dirname(storeFile);
  await mkdir(directory, { recursive: true });

  if (!existsSync(storeFile)) {
    await writeFile(storeFile, JSON.stringify(createSeedStore(), null, 2), "utf8");
  }
}

async function readStore(): Promise<DataStore> {
  await ensureStore();
  const raw = await readFile(storeFile, "utf8");
  const rawParsed = JSON.parse(raw) as {
    personas?: Array<Record<string, unknown>>;
    messages?: Array<Record<string, unknown>>;
  };
  const normalizedMessages: MessageEntry[] = (rawParsed.messages ?? []).flatMap((message) => {
    const parsedMessage = messageSchema.safeParse({
      ...message,
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
    });

    return parsedMessage.success ? [parsedMessage.data] : [];
  });
  const hydrated = {
    ...rawParsed,
    messages: normalizedMessages,
    personas: (rawParsed.personas ?? []).map((persona) => {
      const hasSoulState =
        typeof persona.mindState === "object" &&
        persona.mindState !== null &&
        "currentDrive" in persona.mindState &&
        "memoryRegions" in persona.mindState &&
        "recentUserStates" in persona.mindState;
      const personalityConstitution = isHydratedPersonalityConstitution(persona.personalityConstitution)
        ? persona.personalityConstitution
        : createPersonalityConstitution({
          name: String(persona.name ?? "Persona"),
          relationship: String(persona.relationship ?? "Unknown"),
          source:
            persona.source === "deceased" || persona.source === "living"
              ? persona.source
              : "living",
          description: String(persona.description ?? ""),
          dossier: persona.dossier as Persona["dossier"],
          heartbeatPolicy: persona.heartbeatPolicy as Persona["heartbeatPolicy"],
          preferenceSignals:
            (persona.preferenceSignals as Persona["preferenceSignals"] | undefined) ?? [],
        });
      const relationshipModel = isHydratedRelationshipModel(persona.relationshipModel)
        ? persona.relationshipModel
        : createRelationshipModel({
          name: String(persona.name ?? "Persona"),
          relationship: String(persona.relationship ?? "Unknown"),
          source:
            persona.source === "deceased" || persona.source === "living"
              ? persona.source
              : "living",
          description: String(persona.description ?? ""),
          dossier: persona.dossier as Persona["dossier"],
          heartbeatPolicy: persona.heartbeatPolicy as Persona["heartbeatPolicy"],
          preferenceSignals:
            (persona.preferenceSignals as Persona["preferenceSignals"] | undefined) ?? [],
          personalityConstitution,
        });
      if (
        hasSoulState &&
        isHydratedPersonalityConstitution(persona.personalityConstitution) &&
        isHydratedRelationshipModel(persona.relationshipModel)
      ) {
        return persona;
      }

      return {
        ...persona,
        personalityConstitution,
        relationshipModel,
        mindState: createInitialMindState({
          persona: {
            name: String(persona.name ?? "Persona"),
            relationship: String(persona.relationship ?? "Unknown"),
            source:
              persona.source === "deceased" || persona.source === "living"
                ? persona.source
                : "living",
            description: String(persona.description ?? ""),
            dossier: persona.dossier as Persona["dossier"],
            heartbeatPolicy: persona.heartbeatPolicy as Persona["heartbeatPolicy"],
            preferenceSignals:
              (persona.preferenceSignals as Persona["preferenceSignals"] | undefined) ?? [],
            personalityConstitution,
            relationshipModel,
          },
          messages: normalizedMessages.filter(
            (message) => message.personaId === persona.id,
          ),
        }),
      };
    }),
  };
  const parsed = dataStoreSchema.parse(hydrated);
  let changed = false;
  const humeConfigured = Boolean(process.env.HUME_API_KEY?.trim());

  const migrated: DataStore = {
    ...parsed,
    personas: parsed.personas.map((persona) => {
      const seededVoiceId =
        seededHouseVoiceMap[persona.id as keyof typeof seededHouseVoiceMap];

      if (
        humeConfigured &&
        seededVoiceId &&
        (
          persona.voice.provider !== "hume" ||
          persona.voice.voiceId !== seededVoiceId ||
          persona.voice.status !== "preview_only" ||
          persona.voice.cloneState !== "none"
        )
      ) {
        changed = true;
        return {
          ...persona,
          voice: {
            provider: "hume",
            voiceId: seededVoiceId,
            status: "preview_only",
            cloneState: "none",
            watermarkApplied: false,
          },
        };
      }

      return persona;
    }),
  };

  if (changed) {
    await writeStore(migrated);
  }

  return migrated;
}

async function writeStore(store: DataStore) {
  const validated = dataStoreSchema.parse(store);
  await writeFile(storeFile, JSON.stringify(validated, null, 2), "utf8");
}

async function withStoreLock<T>(operation: () => Promise<T>) {
  const previous = pendingWrite;
  let release!: () => void;

  pendingWrite = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;

  try {
    return await operation();
  } finally {
    release();
  }
}

export async function listPersonas() {
  const store = await readStore();
  return store.personas.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listPendingReview() {
  const store = await readStore();
  return store.personas.filter((persona) => persona.status === "pending_review");
}

export async function getPersona(personaId: string) {
  const store = await readStore();
  return store.personas.find((persona) => persona.id === personaId) ?? null;
}

export async function savePersona(persona: Persona) {
  return withStoreLock(async () => {
    const store = await readStore();
    const index = store.personas.findIndex((entry) => entry.id === persona.id);
    const nextRevision = index === -1 ? persona.revision ?? 1 : store.personas[index].revision + 1;
    const parsedPersona = personaSchema.parse({
      ...persona,
      revision: nextRevision,
    });

    if (index === -1) {
      store.personas.push(parsedPersona);
    } else {
      store.personas[index] = parsedPersona;
    }

    await writeStore(store);
    return parsedPersona;
  });
}

export async function updatePersona(personaId: string, updater: (persona: Persona) => Persona) {
  return withStoreLock(async () => {
    const store = await readStore();
    const index = store.personas.findIndex((persona) => persona.id === personaId);

    if (index === -1) {
      throw new Error(`Persona ${personaId} was not found.`);
    }

    const updated = personaSchema.parse({
      ...updater(store.personas[index]),
      revision: store.personas[index].revision + 1,
    });
    store.personas[index] = updated;
    await writeStore(store);
    return updated;
  });
}

export async function replacePersonaIfRevision(
  personaId: string,
  expectedRevision: number,
  updater: (persona: Persona) => Persona,
) {
  return withStoreLock(async () => {
    const store = await readStore();
    const index = store.personas.findIndex((persona) => persona.id === personaId);

    if (index === -1) {
      throw new Error(`Persona ${personaId} was not found.`);
    }

    const current = store.personas[index];
    if (current.revision !== expectedRevision) {
      return {
        matched: false as const,
        persona: current,
      };
    }

    const updated = personaSchema.parse({
      ...updater(current),
      revision: current.revision + 1,
    });
    store.personas[index] = updated;
    await writeStore(store);

    return {
      matched: true as const,
      persona: updated,
    };
  });
}

export async function enqueuePersonaShadowTurn(personaId: string, shadowTurn: PendingShadowTurn) {
  return updatePersona(personaId, (persona) => ({
    ...persona,
    updatedAt: new Date().toISOString(),
    mindState: {
      ...persona.mindState,
      pendingShadowTurns: [
        ...persona.mindState.pendingShadowTurns.filter((job) => job.id !== shadowTurn.id),
        shadowTurn,
      ].slice(-32),
    },
  }));
}

export async function claimPersonaShadowTurn(personaId: string, sessionId?: string) {
  return withStoreLock(async () => {
    const store = await readStore();
    const index = store.personas.findIndex((persona) => persona.id === personaId);

    if (index === -1) {
      throw new Error(`Persona ${personaId} was not found.`);
    }

    const persona = store.personas[index];
    const jobIndex = persona.mindState.pendingShadowTurns.findIndex((job) => {
      if (job.status !== "pending") {
        return false;
      }

      if (!sessionId) {
        return true;
      }

      return job.sessionId === sessionId;
    });

    if (jobIndex === -1) {
      return null;
    }

    const claimedAt = new Date().toISOString();
    const claimedJob: PendingShadowTurn = {
      ...persona.mindState.pendingShadowTurns[jobIndex],
      status: "processing",
      claimedAt,
      attempts: persona.mindState.pendingShadowTurns[jobIndex].attempts + 1,
      baseRevision: persona.revision + 1,
      lastError: undefined,
    };
    const updatedPersona = personaSchema.parse({
      ...persona,
      revision: persona.revision + 1,
      updatedAt: claimedAt,
      mindState: {
        ...persona.mindState,
        pendingShadowTurns: persona.mindState.pendingShadowTurns.map((job, entryIndex) =>
          entryIndex === jobIndex ? claimedJob : job,
        ),
      },
    });

    store.personas[index] = updatedPersona;
    await writeStore(store);

    return {
      persona: updatedPersona,
      job: claimedJob,
    };
  });
}

export async function claimPersonaShadowTurnById(personaId: string, jobId: string) {
  return withStoreLock(async () => {
    const store = await readStore();
    const index = store.personas.findIndex((persona) => persona.id === personaId);

    if (index === -1) {
      throw new Error(`Persona ${personaId} was not found.`);
    }

    const persona = store.personas[index];
    const jobIndex = persona.mindState.pendingShadowTurns.findIndex(
      (job) => job.id === jobId && job.status === "pending",
    );

    if (jobIndex === -1) {
      return null;
    }

    const claimedAt = new Date().toISOString();
    const claimedJob: PendingShadowTurn = {
      ...persona.mindState.pendingShadowTurns[jobIndex],
      status: "processing",
      claimedAt,
      attempts: persona.mindState.pendingShadowTurns[jobIndex].attempts + 1,
      baseRevision: persona.revision + 1,
      lastError: undefined,
    };
    const updatedPersona = personaSchema.parse({
      ...persona,
      revision: persona.revision + 1,
      updatedAt: claimedAt,
      mindState: {
        ...persona.mindState,
        pendingShadowTurns: persona.mindState.pendingShadowTurns.map((job, entryIndex) =>
          entryIndex === jobIndex ? claimedJob : job,
        ),
      },
    });

    store.personas[index] = updatedPersona;
    await writeStore(store);

    return {
      persona: updatedPersona,
      job: claimedJob,
    };
  });
}

export async function updatePersonaShadowTurn(
  personaId: string,
  jobId: string,
  updater: (job: PendingShadowTurn) => PendingShadowTurn,
) {
  return updatePersona(personaId, (persona) => ({
    ...persona,
    updatedAt: new Date().toISOString(),
    mindState: {
      ...persona.mindState,
      pendingShadowTurns: persona.mindState.pendingShadowTurns.map((job) =>
        job.id === jobId ? updater(job) : job,
      ),
    },
  }));
}

export async function listMessages(personaId: string) {
  const store = await readStore();
  return store.messages
    .filter((message) => message.personaId === personaId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function appendMessages(messages: MessageEntry[]) {
  return withStoreLock(async () => {
    const store = await readStore();
    for (const message of messages) {
      store.messages.push(messageSchema.parse(message));
    }

    await writeStore(store);
    return messages;
  });
}

export async function listPerceptionObservations(personaId: string) {
  const store = await readStore();
  return store.perceptionObservations
    .filter((observation) => observation.personaId === personaId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function appendPerceptionObservations(observations: PerceptionObservation[]) {
  return withStoreLock(async () => {
    const store = await readStore();
    for (const observation of observations) {
      store.perceptionObservations.push(observation);
    }

    await writeStore(store);
    return observations;
  });
}

export async function updateMessage(
  messageId: string,
  updater: (message: MessageEntry) => MessageEntry,
) {
  return withStoreLock(async () => {
    const store = await readStore();
    const index = store.messages.findIndex((message) => message.id === messageId);

    if (index === -1) {
      throw new Error(`Message ${messageId} was not found.`);
    }

    store.messages[index] = updater(store.messages[index]);
    await writeStore(store);
    return store.messages[index];
  });
}

export async function listFeedback(personaId: string) {
  const store = await readStore();
  return store.feedbackEvents
    .filter((feedback) => feedback.personaId === personaId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function appendFeedback(feedback: FeedbackEvent) {
  return withStoreLock(async () => {
    const store = await readStore();
    store.feedbackEvents.push(feedback);
    await writeStore(store);
    return feedback;
  });
}

export async function hasProcessedTelegramUpdate(updateId: string) {
  const store = await readStore();
  return store.processedTelegramUpdates.includes(updateId);
}

export async function markTelegramUpdateProcessed(updateId: string) {
  return withStoreLock(async () => {
    const store = await readStore();

    if (!store.processedTelegramUpdates.includes(updateId)) {
      store.processedTelegramUpdates.push(updateId);
      await writeStore(store);
    }
  });
}

export async function findPersonaByTelegramChat(chatId: number) {
  const store = await readStore();
  return store.personas.find((persona) => persona.telegramChatId === chatId) ?? null;
}

export async function bindTelegramChat(personaId: string, chatId: number, username?: string) {
  return updatePersona(personaId, (persona) => ({
    ...persona,
    telegramChatId: chatId,
    telegramUsername: username,
    updatedAt: new Date().toISOString(),
  }));
}

export async function listPendingTelegramMessages() {
  const store = await readStore();
  return store.messages.filter(
    (message) =>
      message.role === "assistant" &&
      message.delivery.telegramStatus === "pending",
  );
}

export async function savePublicFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
) {
  await mkdir(uploadsDir, { recursive: true });
  const slug = `${Date.now()}-${slugify(fileName || randomUUID())}`;
  const extension = mimeType.includes("png")
    ? ".png"
    : mimeType.includes("jpeg")
      ? ".jpg"
      : mimeType.includes("webm")
        ? ".webm"
        : mimeType.includes("wav")
          ? ".wav"
          : mimeType.includes("mpeg")
            ? ".mp3"
            : path.extname(fileName || "") || ".bin";
  const outputFileName = `${slug}${extension}`;
  const outputPath = path.join(uploadsDir, outputFileName);
  await writeFile(outputPath, buffer);
  return {
    fileName: outputFileName,
    url: `/uploads/${outputFileName}`,
  };
}

export async function resetStoreForTests(store?: DataStore) {
  await mkdir(path.dirname(storeFile), { recursive: true });
  await writeStore(store ?? createSeedStore());
}
