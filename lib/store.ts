import { statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
import { getSupabaseAdminClient, getSupabaseRuntimeConfig } from "@/lib/supabase";
import { getCurrentUserId, withUserStore } from "@/lib/store-context";
import { houseVoicePresets } from "@/lib/voice-presets";
import { slugify } from "@/lib/utils";

const storeFile = process.env.PERSONA_STORE_FILE ?? path.join(process.cwd(), "data", "demo-store.json");
const uploadsDir =
  process.env.PERSONA_UPLOAD_DIR ?? path.join(process.cwd(), "public", "uploads");

let pendingWrite = Promise.resolve();

let cachedStore: DataStore | null = null;
let cachedMtimeMs = 0;

type StoreSnapshot = {
  store: DataStore;
  revision: number;
};

const remoteStoreRetryLimit = 6;
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

function isSupabaseRuntimeStoreEnabled() {
  return Boolean(getSupabaseRuntimeConfig());
}

function cloneStore(store: DataStore): DataStore {
  return JSON.parse(JSON.stringify(store)) as DataStore;
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
    variableInterval: true,
    hourlyActivityCounts: Array(24).fill(0),
    minIntervalHours: 1,
    maxIntervalHours: 8,
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
    variableInterval: true,
    hourlyActivityCounts: Array(24).fill(0),
    minIntervalHours: 1,
    maxIntervalHours: 8,
  };
  const momDossier: Persona["dossier"] = {
    essence: "A reassuring morning texter who leads with care and encouragement.",
    communicationStyle: "Short, warm, punctuation-heavy, and grounding.",
    signaturePhrases: ["sweetie", "honey", "love you"],
    favoriteTopics: ["family", "big life updates", "daily check-ins"],
    emotionalTendencies: ["protective", "optimistic", "deeply proud"],
    routines: ["good-morning check-ins", "follows up after stressful events"],
    guidance: ["Keep warmth first.", "Prefer one concrete follow-up question."],
    sourceSummary:
      "Derived from short loving texts, interview notes, and a demo voice profile.",
    knowledgeProfile: {
      domains: ["family life", "cooking and home", "emotional support", "life advice"],
      deflectionStyle: "redirecting",
      deflectionExamples: [
        "Honey, I have no idea how that works. Ask someone who actually knows.",
        "That's way over my head — but I bet you'll figure it out.",
      ],
    },
  };
  const alexDossier: Persona["dossier"] = {
    essence: "A low-drama, loyal older brother with affectionate sarcasm.",
    communicationStyle: "Brief, lowercase, lightly teasing, emotionally economical.",
    signaturePhrases: ["lmao", "you got this", "don't overthink it"],
    favoriteTopics: ["sports", "music", "family updates"],
    emotionalTendencies: ["guarded", "supportive", "observant"],
    routines: ["checks in after big events", "keeps messages short"],
    guidance: ["Use humor sparingly.", "Keep messages brief."],
    sourceSummary: "Derived from family memories, interview notes, and a demo voice profile.",
    knowledgeProfile: {
      domains: ["sports", "music", "everyday life", "social life"],
      deflectionStyle: "self_deprecating",
      deflectionExamples: [
        "Dude I barely passed that class, don't ask me.",
        "Absolutely no clue. Try Google?",
      ],
    },
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
    source: "living",
    description:
      "Dry humor, sports references, short responses, affectionate beneath the sarcasm.",
    dossier: alexDossier,
    heartbeatPolicy: alexHeartbeatPolicy,
    preferenceSignals: alexPreferenceSignals,
  });
  const alexRelationshipModel = createRelationshipModel({
    name: "Alex Rivera",
    relationship: "Older brother",
    source: "living",
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
      source: "living",
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
        source: "living",
        description:
          "Dry humor, sports references, short responses, affectionate beneath the sarcasm.",
        status: "active",
        avatarUrl: undefined,
        createdAt: iso(-12),
        updatedAt: iso(-12),
        lastActiveAt: undefined,
        lastHeartbeatAt: undefined,
        pastedText: "lmao. you got this. don't overthink it.",
        screenshotSummaries: ["Uses clipped messages, lowercase, and quick sarcastic reassurance."],
        interviewAnswers: {
          "What topics lit them up immediately?": "Basketball, music, and family gossip.",
        },
        heartbeatPolicy: alexHeartbeatPolicy,
        voice: alexVoice,
        consent: {
          attestedRights: true,
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
  };
}

function hydrateStore(rawStore: unknown): DataStore {
  const rawParsed = rawStore as {
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
      const normalizedSource: Persona["source"] = "living";
      const normalizedStatus: Persona["status"] =
        persona.status === "draft" ? "draft" : "active";
      const normalizedConsent: Persona["consent"] = {
        attestedRights:
          typeof persona.consent === "object" &&
          persona.consent !== null &&
          "attestedRights" in persona.consent
            ? Boolean(persona.consent.attestedRights)
            : true,
        createdAt:
          typeof persona.consent === "object" &&
          persona.consent !== null &&
          "createdAt" in persona.consent &&
          typeof persona.consent.createdAt === "string"
            ? persona.consent.createdAt
            : new Date().toISOString(),
      };
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
          source: normalizedSource,
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
          source: normalizedSource,
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
        return {
          ...persona,
          source: normalizedSource,
          status: normalizedStatus,
          consent: normalizedConsent,
        };
      }

      return {
        ...persona,
        source: normalizedSource,
        status: normalizedStatus,
        consent: normalizedConsent,
        personalityConstitution,
        relationshipModel,
        mindState: createInitialMindState({
          persona: {
            name: String(persona.name ?? "Persona"),
            relationship: String(persona.relationship ?? "Unknown"),
            source: normalizedSource,
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
  const humeConfigured = Boolean(process.env.HUME_API_KEY?.trim());

  return {
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
}

async function ensureRemoteStore() {
  const userId = getCurrentUserId();
  const config = getSupabaseRuntimeConfig(userId);
  const client = getSupabaseAdminClient();

  if (!config || !client) {
    throw new Error("Supabase runtime store is not configured.");
  }

  const seed = dataStoreSchema.parse(createSeedStore());
  const { error } = await client
    .from(config.table)
    .upsert(
      {
        store_key: config.key,
        revision: 1,
        payload: seed,
      },
      {
        onConflict: "store_key",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    throw new Error(`Unable to initialize Supabase runtime store: ${error.message}`);
  }
}

async function readRemoteStore(): Promise<StoreSnapshot> {
  const userId = getCurrentUserId();
  const config = getSupabaseRuntimeConfig(userId);
  const client = getSupabaseAdminClient();

  if (!config || !client) {
    throw new Error("Supabase runtime store is not configured.");
  }

  await ensureRemoteStore();

  const { data, error } = await client
    .from(config.table)
    .select("revision, payload")
    .eq("store_key", config.key)
    .single();

  if (error || !data) {
    throw new Error(`Unable to read Supabase runtime store: ${error?.message ?? "missing row"}`);
  }

  return {
    store: hydrateStore(data.payload),
    revision: typeof data.revision === "number" ? data.revision : 1,
  };
}

async function writeRemoteStore(
  snapshot: StoreSnapshot,
  expectedRevision: number,
): Promise<StoreSnapshot | null> {
  const userId = getCurrentUserId();
  const config = getSupabaseRuntimeConfig(userId);
  const client = getSupabaseAdminClient();

  if (!config || !client) {
    throw new Error("Supabase runtime store is not configured.");
  }

  const payload = dataStoreSchema.parse(snapshot.store);
  const { data, error } = await client
    .from(config.table)
    .update({
      revision: expectedRevision + 1,
      payload,
      updated_at: new Date().toISOString(),
    })
    .eq("store_key", config.key)
    .eq("revision", expectedRevision)
    .select("revision, payload")
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to write Supabase runtime store: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    store: hydrateStore(data.payload),
    revision: typeof data.revision === "number" ? data.revision : expectedRevision + 1,
  };
}

async function ensureStore() {
  const directory = path.dirname(storeFile);
  await mkdir(directory, { recursive: true });

  try {
    await writeFile(storeFile, JSON.stringify(createSeedStore(), null, 2), { encoding: "utf8", flag: "wx" });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function readFileStoreSnapshot(): Promise<StoreSnapshot> {
  await ensureStore();

  try {
    const mtimeMs = statSync(storeFile).mtimeMs;
    if (cachedStore && mtimeMs === cachedMtimeMs) {
      return {
        store: cloneStore(cachedStore),
        revision: 0,
      };
    }
  } catch {
    // stat failed — fall through to full read
  }

  const raw = await readFile(storeFile, "utf8");
  const hydrated = hydrateStore(JSON.parse(raw));

  try {
    cachedMtimeMs = statSync(storeFile).mtimeMs;
  } catch {
    cachedMtimeMs = 0;
  }
  cachedStore = hydrated;

  return {
    store: hydrated,
    revision: 0,
  };
}

async function readStoreSnapshot(): Promise<StoreSnapshot> {
  if (isSupabaseRuntimeStoreEnabled()) {
    return readRemoteStore();
  }

  return readFileStoreSnapshot();
}

async function readStore(): Promise<DataStore> {
  return (await readStoreSnapshot()).store;
}

async function writeFileStore(store: DataStore) {
  const validated = dataStoreSchema.parse(store);
  const nextContent = JSON.stringify(validated, null, 2);
  const tempFile = `${storeFile}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempFile, nextContent, "utf8");
  await rename(tempFile, storeFile);

  // Update cache after successful write
  cachedStore = validated;
  try {
    cachedMtimeMs = statSync(storeFile).mtimeMs;
  } catch {
    cachedMtimeMs = 0;
  }

  return {
    store: validated,
    revision: 0,
  } satisfies StoreSnapshot;
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

async function mutateStore<T>(
  mutation: (store: DataStore) => Promise<T> | T,
): Promise<T> {
  if (!isSupabaseRuntimeStoreEnabled()) {
    return withStoreLock(async () => {
      const snapshot = await readFileStoreSnapshot();
      const working = cloneStore(snapshot.store);
      const result = await mutation(working);
      await writeFileStore(working);
      return result;
    });
  }

  for (let attempt = 0; attempt < remoteStoreRetryLimit; attempt += 1) {
    const snapshot = await readStoreSnapshot();
    const working = cloneStore(snapshot.store);
    const result = await mutation(working);
    const committed = await writeRemoteStore({ store: working, revision: snapshot.revision }, snapshot.revision);

    if (committed) {
      return result;
    }
  }

  throw new Error("Supabase runtime store write conflicted too many times.");
}

// ---------------------------------------------------------------------------
// Persona CRUD — reads/writes go through the shared runtime store (Supabase
// or local file), with optimistic-concurrency revision checks on mutations.
//
// Concurrency model:
//   File store  — serialized writes via mutex (safe for a single process).
//   Supabase    — optimistic concurrency with revision checks and retries,
//                 then throws on conflict. No distributed locking exists,
//                 so multi-instance deployments may see write conflicts.
//                 This is acceptable for single-instance Vercel deployment.
// ---------------------------------------------------------------------------

function sortPersonasByUpdatedAt(personas: Persona[]) {
  return [...personas].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** List all personas sorted by most recently updated. */
export async function listPersonas() {
  const store = await readStore();
  return sortPersonasByUpdatedAt(store.personas);
}

export async function getPersona(personaId: string) {
  const store = await readStore();
  return store.personas.find((persona) => persona.id === personaId) ?? null;
}

/** List personas owned by a specific user across both storage modes. */
export async function listPersonasForUser(userId: string) {
  const loadOwnedPersonas = async () =>
    sortPersonasByUpdatedAt(
      (await listPersonas()).filter((persona) => persona.userId === userId),
    );

  if (isSupabaseRuntimeStoreEnabled()) {
    return withUserStore(userId, loadOwnedPersonas);
  }

  return loadOwnedPersonas();
}

/** Get a persona only if it belongs to the requested user. */
export async function getPersonaForUser(userId: string, personaId: string) {
  const loadOwnedPersona = async () => {
    const persona = await getPersona(personaId);
    return persona?.userId === userId ? persona : null;
  };

  if (isSupabaseRuntimeStoreEnabled()) {
    return withUserStore(userId, loadOwnedPersona);
  }

  return loadOwnedPersona();
}

export async function savePersona(persona: Persona) {
  return mutateStore(async (store) => {
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

    return parsedPersona;
  });
}

export async function updatePersona(personaId: string, updater: (persona: Persona) => Persona) {
  return mutateStore(async (store) => {
    const index = store.personas.findIndex((persona) => persona.id === personaId);

    if (index === -1) {
      throw new Error(`Persona ${personaId} was not found.`);
    }

    const updated = personaSchema.parse({
      ...updater(store.personas[index]),
      revision: store.personas[index].revision + 1,
    });
    store.personas[index] = updated;
    return updated;
  });
}

/** Atomically replace a persona only if the revision matches (optimistic concurrency). */
export async function replacePersonaIfRevision(
  personaId: string,
  expectedRevision: number,
  updater: (persona: Persona) => Persona,
) {
  if (!isSupabaseRuntimeStoreEnabled()) {
    return withStoreLock(async () => {
      const snapshot = await readFileStoreSnapshot();
      const store = cloneStore(snapshot.store);
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
      await writeFileStore(store);

      return {
        matched: true as const,
        persona: updated,
      };
    });
  }

  for (let attempt = 0; attempt < remoteStoreRetryLimit; attempt += 1) {
    const snapshot = await readStoreSnapshot();
    const store = cloneStore(snapshot.store);
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
    const committed = await writeRemoteStore({ store, revision: snapshot.revision }, snapshot.revision);

    if (committed) {
      return {
        matched: true as const,
        persona: updated,
      };
    }
  }

  throw new Error(`Persona ${personaId} revision update conflicted too many times.`);
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
  const claimJob = async (snapshot: StoreSnapshot) => {
    const store = cloneStore(snapshot.store);
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
    return {
      store,
      updatedPersona,
      claimedJob,
    };
  };

  if (!isSupabaseRuntimeStoreEnabled()) {
    return withStoreLock(async () => {
      const snapshot = await readFileStoreSnapshot();
      const claimed = await claimJob(snapshot);

      if (!claimed) {
        return null;
      }

      await writeFileStore(claimed.store);
      return {
        persona: claimed.updatedPersona,
        job: claimed.claimedJob,
      };
    });
  }

  for (let attempt = 0; attempt < remoteStoreRetryLimit; attempt += 1) {
    const snapshot = await readStoreSnapshot();
    const claimed = await claimJob(snapshot);

    if (!claimed) {
      return null;
    }

    const committed = await writeRemoteStore(
      { store: claimed.store, revision: snapshot.revision },
      snapshot.revision,
    );

    if (committed) {
      return {
        persona: claimed.updatedPersona,
        job: claimed.claimedJob,
      };
    }
  }

  throw new Error(`Unable to claim shadow turn for persona ${personaId}.`);
}

export async function claimPersonaShadowTurnById(personaId: string, jobId: string) {
  const claimJob = async (snapshot: StoreSnapshot) => {
    const store = cloneStore(snapshot.store);
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
    return {
      store,
      updatedPersona,
      claimedJob,
    };
  };

  if (!isSupabaseRuntimeStoreEnabled()) {
    return withStoreLock(async () => {
      const snapshot = await readFileStoreSnapshot();
      const claimed = await claimJob(snapshot);

      if (!claimed) {
        return null;
      }

      await writeFileStore(claimed.store);
      return {
        persona: claimed.updatedPersona,
        job: claimed.claimedJob,
      };
    });
  }

  for (let attempt = 0; attempt < remoteStoreRetryLimit; attempt += 1) {
    const snapshot = await readStoreSnapshot();
    const claimed = await claimJob(snapshot);

    if (!claimed) {
      return null;
    }

    const committed = await writeRemoteStore(
      { store: claimed.store, revision: snapshot.revision },
      snapshot.revision,
    );

    if (committed) {
      return {
        persona: claimed.updatedPersona,
        job: claimed.claimedJob,
      };
    }
  }

  throw new Error(`Unable to claim shadow turn ${jobId} for persona ${personaId}.`);
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

// ---------------------------------------------------------------------------
// Messages, observations, and feedback — append-only collections.
// ---------------------------------------------------------------------------

/** List messages for a persona, sorted by creation time. */
export async function listMessages(personaId: string) {
  const store = await readStore();
  return store.messages
    .filter((message) => message.personaId === personaId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function appendMessages(messages: MessageEntry[]) {
  return mutateStore(async (store) => {
    for (const message of messages) {
      store.messages.push(messageSchema.parse(message));
    }

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
  return mutateStore(async (store) => {
    for (const observation of observations) {
      store.perceptionObservations.push(observation);
    }

    return observations;
  });
}

export async function updateMessage(
  messageId: string,
  updater: (message: MessageEntry) => MessageEntry,
) {
  return mutateStore(async (store) => {
    const index = store.messages.findIndex((message) => message.id === messageId);

    if (index === -1) {
      throw new Error(`Message ${messageId} was not found.`);
    }

    const updated = messageSchema.parse(updater(store.messages[index]));
    store.messages[index] = updated;
    return updated;
  });
}

export async function listFeedback(personaId: string) {
  const store = await readStore();
  return store.feedbackEvents
    .filter((feedback) => feedback.personaId === personaId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export async function appendFeedback(feedback: FeedbackEvent) {
  return mutateStore(async (store) => {
    store.feedbackEvents.push(feedback);
    return feedback;
  });
}

/** Persist a file to Supabase Storage or the local uploads directory. Returns the public URL. */
export async function savePublicFile(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
) {
  const supabaseConfig = getSupabaseRuntimeConfig();
  const supabase = getSupabaseAdminClient();

  if (supabaseConfig && supabase) {
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
    const objectPath = `uploads/${outputFileName}`;
    const { error } = await supabase.storage
      .from(supabaseConfig.bucket)
      .upload(objectPath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (error) {
      throw new Error(`Unable to upload file to Supabase Storage: ${error.message}`);
    }

    const { data } = supabase.storage.from(supabaseConfig.bucket).getPublicUrl(objectPath);
    return {
      fileName: outputFileName,
      url: data.publicUrl,
    };
  }

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
  cachedStore = null;
  cachedMtimeMs = 0;
  await mkdir(path.dirname(storeFile), { recursive: true });
  await writeFileStore(store ?? createSeedStore());
}
