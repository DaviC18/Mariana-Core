export type LeadStatus = "new" | "qualifying" | "qualified" | "scheduled";
export type Lead = { id: string; name: string; phone: string; email: string | null; source: string; status: LeadStatus; createdAt: string; updatedAt: string };
export type Conversation = { id: string; leadId: string; status: "active" | "closed"; startedAt: string; updatedAt: string; lastCustomerMessageAt: string | null; optOutAt: string | null };
export type Message = { id: string; conversationId: string; role: "user" | "assistant" | "system"; content: string; createdAt: string; processedAt: string | null };
export type Appointment = { id: string; leadId: string; consultantId: string; startAt: string; endAt: string; status: string; externalEventId: string; createdAt: string };
