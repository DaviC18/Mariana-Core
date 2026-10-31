import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const systemSettings = pgTable("system_settings", {
	key: text().primaryKey(),
	updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	value: jsonb().notNull(),
});
