export type Shop = {
  name: string;
  timezone: string;
  publicUrl: string;
  accent: string;
  setupRequired: boolean;
};
export type Product = {
  id: string;
  name: string;
  length: string;
  image: string;
  capacity: number;
  issued: number;
  waiting: number;
  admitted: number;
  cancelled: number;
  remaining: number;
};
export type EventState = {
  id: string;
  title: string;
  start: number;
  end: number;
  expires: number;
  earlyAt: number | null;
  phase: "upcoming" | "open" | "settling" | "ended";
  open: boolean;
  paused: boolean;
  called: number;
  capacity: number;
  issued: number;
  remaining: number;
  waiting: number;
  admitted: number;
  cancelled: number;
  products: Product[];
  serverNow: number;
};
export type Ticket = {
  id: string;
  eventId: string;
  no: number;
  productId: string;
  changes: number;
  status: "waiting" | "admitted" | "cancelled";
};
export type AdminData = {
  shop: Shop;
  events: EventState[];
  network: { addresses: string[]; local: string };
};
