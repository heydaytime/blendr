export interface Message {
  type: string;
  videoId?: string;
  timestamp?: number;
  playing?: boolean;
  twitchId?: string;
  twitchPosition?: string;
  redirectUrl?: string;
  data?: unknown;
}

export function isValidSync(msg: Message): boolean {
  return msg.type === "sync" && !!msg.videoId;
}

export function isValidRedirect(msg: Message): boolean {
  return msg.type === "redirect" && !!msg.redirectUrl;
}
