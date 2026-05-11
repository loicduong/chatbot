create table if not exists public."User" (
  "id" uuid primary key references auth.users ("id") on delete cascade,
  "email" varchar(320) not null,
  "password" varchar(64),
  "name" text,
  "emailVerified" boolean not null default false,
  "image" text,
  "isAnonymous" boolean not null default false,
  "createdAt" timestamp with time zone not null default now(),
  "updatedAt" timestamp with time zone not null default now()
);

create table if not exists public."Chat" (
  "id" uuid primary key default gen_random_uuid(),
  "createdAt" timestamp with time zone not null default now(),
  "title" text not null,
  "userId" uuid not null references public."User" ("id") on delete cascade,
  "visibility" varchar(16) not null default 'private',
  constraint "Chat_visibility_check" check ("visibility" in ('public', 'private'))
);

create table if not exists public."Message_v2" (
  "id" uuid primary key default gen_random_uuid(),
  "chatId" uuid not null references public."Chat" ("id") on delete cascade,
  "role" varchar not null,
  "parts" jsonb not null,
  "attachments" jsonb not null default '[]'::jsonb,
  "createdAt" timestamp with time zone not null default now()
);

create table if not exists public."Vote_v2" (
  "chatId" uuid not null references public."Chat" ("id") on delete cascade,
  "messageId" uuid not null references public."Message_v2" ("id") on delete cascade,
  "isUpvoted" boolean not null,
  primary key ("chatId", "messageId")
);

create table if not exists public."Document" (
  "id" uuid not null default gen_random_uuid(),
  "createdAt" timestamp with time zone not null default now(),
  "title" text not null,
  "content" text,
  "kind" varchar(16) not null default 'text',
  "userId" uuid not null references public."User" ("id") on delete cascade,
  constraint "Document_kind_check" check ("kind" in ('text', 'code', 'image', 'sheet')),
  primary key ("id", "createdAt")
);

create table if not exists public."Suggestion" (
  "id" uuid primary key default gen_random_uuid(),
  "documentId" uuid not null,
  "documentCreatedAt" timestamp with time zone not null,
  "originalText" text not null,
  "suggestedText" text not null,
  "description" text,
  "isResolved" boolean not null default false,
  "userId" uuid not null references public."User" ("id") on delete cascade,
  "createdAt" timestamp with time zone not null default now(),
  constraint "Suggestion_document_fk"
    foreign key ("documentId", "documentCreatedAt")
    references public."Document" ("id", "createdAt")
    on delete cascade
);

create index if not exists "Chat_userId_createdAt_idx"
  on public."Chat" ("userId", "createdAt" desc);

create index if not exists "Message_v2_chatId_createdAt_idx"
  on public."Message_v2" ("chatId", "createdAt");

create index if not exists "Document_id_createdAt_idx"
  on public."Document" ("id", "createdAt" desc);

create index if not exists "Suggestion_documentId_idx"
  on public."Suggestion" ("documentId");
