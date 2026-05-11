import "server-only";

import type { ArtifactKind } from "@/components/chat/artifact";
import type { VisibilityType } from "@/components/chat/visibility-selector";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { ChatbotError } from "../errors";
import { generateUUID } from "../utils";
import type {
  Chat,
  DBMessage,
  Document,
  Suggestion,
  User,
  Vote,
} from "./schema";

function db() {
  return createSupabaseAdminClient();
}

function parseDate<T extends Record<string, unknown>>(row: T, key: keyof T): T {
  const value = row[key];

  return {
    ...row,
    [key]: typeof value === "string" ? new Date(value) : value,
  };
}

function parseChat(row: Record<string, unknown>): Chat {
  return parseDate(row, "createdAt") as Chat;
}

function parseMessage(row: Record<string, unknown>): DBMessage {
  return parseDate(row, "createdAt") as DBMessage;
}

function parseDocument(row: Record<string, unknown>): Document {
  return parseDate(row, "createdAt") as Document;
}

function parseSuggestion(row: Record<string, unknown>): Suggestion {
  return parseDate(
    parseDate(row, "createdAt"),
    "documentCreatedAt"
  ) as Suggestion;
}

function parseUser(row: Record<string, unknown>): User {
  return parseDate(parseDate(row, "createdAt"), "updatedAt") as User;
}

function iso(date: Date | string) {
  return date instanceof Date ? date.toISOString() : date;
}

export async function ensureUserProfile({
  id,
  email,
  isAnonymous = false,
}: {
  id: string;
  email?: string | null;
  isAnonymous?: boolean;
}) {
  const fallbackEmail = email ?? `guest-${id}@anonymous.local`;

  const { data, error } = await db()
    .from("User")
    .upsert(
      {
        id,
        email: fallbackEmail,
        isAnonymous,
        updatedAt: new Date().toISOString(),
      },
      { onConflict: "id" }
    )
    .select()
    .single();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to ensure user profile"
    );
  }

  return parseUser(data);
}

export async function getUser(email: string): Promise<User[]> {
  const { data, error } = await db().from("User").select().eq("email", email);

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get user by email"
    );
  }

  return (data ?? []).map(parseUser);
}

export async function createUser(email: string, _password: string) {
  const { data, error } = await db()
    .from("User")
    .insert({
      email,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .select();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to create user");
  }

  return data?.map(parseUser) ?? [];
}

export async function createGuestUser() {
  const id = generateUUID();
  const email = `guest-${Date.now()}@anonymous.local`;

  const { data, error } = await db()
    .from("User")
    .insert({
      id,
      email,
      isAnonymous: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .select("id,email");

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to create guest user"
    );
  }

  return data ?? [];
}

export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  const { data, error } = await db()
    .from("Chat")
    .insert({
      id,
      userId,
      title,
      visibility,
      createdAt: new Date().toISOString(),
    })
    .select();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to save chat");
  }

  return data?.map(parseChat) ?? [];
}

export async function deleteChatById({ id }: { id: string }) {
  const supabase = db();

  await supabase.from("Vote_v2").delete().eq("chatId", id);
  await supabase.from("Message_v2").delete().eq("chatId", id);

  const { data, error } = await supabase
    .from("Chat")
    .delete()
    .eq("id", id)
    .select()
    .single();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete chat by id"
    );
  }

  return parseChat(data);
}

export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  const supabase = db();
  const { data: userChats, error: chatError } = await supabase
    .from("Chat")
    .select("id")
    .eq("userId", userId);

  if (chatError) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }

  const chatIds = (userChats ?? []).map((chat) => chat.id);

  if (chatIds.length === 0) {
    return { deletedCount: 0 };
  }

  await supabase.from("Vote_v2").delete().in("chatId", chatIds);
  await supabase.from("Message_v2").delete().in("chatId", chatIds);

  const { data, error } = await supabase
    .from("Chat")
    .delete()
    .eq("userId", userId)
    .select();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete all chats by user id"
    );
  }

  return { deletedCount: data?.length ?? 0 };
}

export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  const supabase = db();
  const extendedLimit = limit + 1;
  let cursorCreatedAt: string | null = null;

  if (startingAfter || endingBefore) {
    const cursorId = startingAfter ?? endingBefore;
    const { data: selectedChat, error } = await supabase
      .from("Chat")
      .select("createdAt")
      .eq("id", cursorId)
      .single();

    if (error || !selectedChat) {
      throw new ChatbotError(
        "not_found:database",
        `Chat with id ${cursorId} not found`
      );
    }

    cursorCreatedAt = selectedChat.createdAt;
  }

  let query = supabase
    .from("Chat")
    .select()
    .eq("userId", id)
    .order("createdAt", { ascending: false })
    .limit(extendedLimit);

  if (startingAfter && cursorCreatedAt) {
    query = query.gt("createdAt", cursorCreatedAt);
  } else if (endingBefore && cursorCreatedAt) {
    query = query.lt("createdAt", cursorCreatedAt);
  }

  const { data, error } = await query;

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get chats by user id"
    );
  }

  const chats = (data ?? []).map(parseChat);
  const hasMore = chats.length > limit;

  return {
    chats: hasMore ? chats.slice(0, limit) : chats,
    hasMore,
  };
}

export async function getChatById({ id }: { id: string }) {
  const { data, error } = await db()
    .from("Chat")
    .select()
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to get chat by id");
  }

  return data ? parseChat(data) : null;
}

export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  const { data, error } = await db()
    .from("Message_v2")
    .insert(
      messages.map((msg) => ({
        ...msg,
        createdAt: iso(msg.createdAt),
      }))
    )
    .select();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to save messages");
  }

  return data?.map(parseMessage) ?? [];
}

export async function updateMessage({
  id,
  parts,
}: {
  id: string;
  parts: DBMessage["parts"];
}) {
  const { data, error } = await db()
    .from("Message_v2")
    .update({ parts })
    .eq("id", id)
    .select();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to update message");
  }

  return data?.map(parseMessage) ?? [];
}

export async function getMessagesByChatId({ id }: { id: string }) {
  const { data, error } = await db()
    .from("Message_v2")
    .select()
    .eq("chatId", id)
    .order("createdAt", { ascending: true });

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get messages by chat id"
    );
  }

  return (data ?? []).map(parseMessage);
}

export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  const { data, error } = await db()
    .from("Vote_v2")
    .upsert(
      {
        chatId,
        messageId,
        isUpvoted: type === "up",
      },
      { onConflict: "chatId,messageId" }
    )
    .select();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to vote message");
  }

  return data ?? [];
}

export async function getVotesByChatId({ id }: { id: string }) {
  const { data, error } = await db().from("Vote_v2").select().eq("chatId", id);

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get votes by chat id"
    );
  }

  return (data ?? []) as Vote[];
}

export async function saveDocument({
  id,
  title,
  kind,
  content,
  userId,
}: {
  id: string;
  title: string;
  kind: ArtifactKind;
  content: string;
  userId: string;
}) {
  const { data, error } = await db()
    .from("Document")
    .insert({
      id,
      title,
      kind,
      content,
      userId,
      createdAt: new Date().toISOString(),
    })
    .select();

  if (error) {
    throw new ChatbotError("bad_request:database", "Failed to save document");
  }

  return data?.map(parseDocument) ?? [];
}

export async function updateDocumentContent({
  id,
  content,
}: {
  id: string;
  content: string;
}) {
  const latest = await getDocumentById({ id });

  if (!latest) {
    throw new ChatbotError("not_found:database", "Document not found");
  }

  const { data, error } = await db()
    .from("Document")
    .update({ content })
    .eq("id", id)
    .eq("createdAt", iso(latest.createdAt))
    .select();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update document content"
    );
  }

  return data?.map(parseDocument) ?? [];
}

export async function getDocumentsById({ id }: { id: string }) {
  const { data, error } = await db()
    .from("Document")
    .select()
    .eq("id", id)
    .order("createdAt", { ascending: true });

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get documents by id"
    );
  }

  return (data ?? []).map(parseDocument);
}

export async function getDocumentById({ id }: { id: string }) {
  const { data, error } = await db()
    .from("Document")
    .select()
    .eq("id", id)
    .order("createdAt", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get document by id"
    );
  }

  return data ? parseDocument(data) : null;
}

export async function deleteDocumentsByIdAfterTimestamp({
  id,
  timestamp,
}: {
  id: string;
  timestamp: Date;
}) {
  const supabase = db();
  const timestampIso = timestamp.toISOString();

  await supabase
    .from("Suggestion")
    .delete()
    .eq("documentId", id)
    .gt("documentCreatedAt", timestampIso);

  const { data, error } = await supabase
    .from("Document")
    .delete()
    .eq("id", id)
    .gt("createdAt", timestampIso)
    .select();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete documents by id after timestamp"
    );
  }

  return data?.map(parseDocument) ?? [];
}

export async function saveSuggestions({
  suggestions,
}: {
  suggestions: Suggestion[];
}) {
  const { data, error } = await db()
    .from("Suggestion")
    .insert(
      suggestions.map((suggestion) => ({
        ...suggestion,
        createdAt: iso(suggestion.createdAt),
        documentCreatedAt: iso(suggestion.documentCreatedAt),
      }))
    )
    .select();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to save suggestions"
    );
  }

  return data?.map(parseSuggestion) ?? [];
}

export async function getSuggestionsByDocumentId({
  documentId,
}: {
  documentId: string;
}) {
  const { data, error } = await db()
    .from("Suggestion")
    .select()
    .eq("documentId", documentId);

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }

  return (data ?? []).map(parseSuggestion);
}

export async function getMessageById({ id }: { id: string }) {
  const { data, error } = await db().from("Message_v2").select().eq("id", id);

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message by id"
    );
  }

  return (data ?? []).map(parseMessage);
}

export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  const supabase = db();
  const timestampIso = timestamp.toISOString();
  const { data: messagesToDelete, error: selectError } = await supabase
    .from("Message_v2")
    .select("id")
    .eq("chatId", chatId)
    .gte("createdAt", timestampIso);

  if (selectError) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }

  const messageIds = (messagesToDelete ?? []).map((message) => message.id);

  if (messageIds.length === 0) {
    return [];
  }

  await supabase
    .from("Vote_v2")
    .delete()
    .eq("chatId", chatId)
    .in("messageId", messageIds);

  const { data, error } = await supabase
    .from("Message_v2")
    .delete()
    .eq("chatId", chatId)
    .in("id", messageIds)
    .select();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }

  return data?.map(parseMessage) ?? [];
}

export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  const { data, error } = await db()
    .from("Chat")
    .update({ visibility })
    .eq("id", chatId)
    .select();

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to update chat visibility by id"
    );
  }

  return data?.map(parseChat) ?? [];
}

export async function updateChatTitleById({
  chatId,
  title,
}: {
  chatId: string;
  title: string;
}) {
  await db().from("Chat").update({ title }).eq("id", chatId);
}

export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  const cutoffTime = new Date(
    Date.now() - differenceInHours * 60 * 60 * 1000
  ).toISOString();

  const { data: chats, error: chatError } = await db()
    .from("Chat")
    .select("id")
    .eq("userId", id);

  if (chatError) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }

  const chatIds = (chats ?? []).map((chat) => chat.id);

  if (chatIds.length === 0) {
    return 0;
  }

  const { count, error } = await db()
    .from("Message_v2")
    .select("id", { count: "exact", head: true })
    .in("chatId", chatIds)
    .gte("createdAt", cutoffTime)
    .eq("role", "user");

  if (error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get message count by user id"
    );
  }

  return count ?? 0;
}
