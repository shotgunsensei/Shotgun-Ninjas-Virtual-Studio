export const SELECT_NONE = "**none**";
export const SELECT_DEFAULT = "**default**";
export const SELECT_EMPTY_DEVICE_PREFIX = "**device**:";

export function deviceSelectValue(id: string | null | undefined, index: number): string {
  return id && id.length > 0 ? id : `${SELECT_EMPTY_DEVICE_PREFIX}${index}`;
}

export function deviceSelectId(value: string): string {
  return value.startsWith(SELECT_EMPTY_DEVICE_PREFIX) ? "" : value;
}

export function selectValueOrNone(value: string | null | undefined): string {
  return value && value.length > 0 ? value : SELECT_NONE;
}
