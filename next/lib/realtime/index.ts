// Public API of the real-time layer (Client Components only). See next/docs/carpool.md ("Real-time layer").
export { useRealtimeEvent, useRealtimeRoom, useRealtimeStatus } from "@/lib/realtime/hooks";
export type { ConnectionStatus, RoomSnapshot, RoomStatus } from "@/lib/realtime/client";
