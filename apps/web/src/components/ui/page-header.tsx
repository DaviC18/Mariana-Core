import type { ReactNode } from "react";
export function PageHeader({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{action}</div>; }
