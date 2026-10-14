import { MAX_SIZE_MB } from '@/components/asset/AttachmentsPanel';

/**
 * Registration photos — REQ-REQUEST-020. The server's rules for a
 * `REGISTRATION_PHOTO`, checked before sending so the refusal can be worded in
 * the person's language: JPG or PNG, by extension and by type, within the
 * existing attachment size limit. The server remains the authority.
 */

export const REGISTRATION_PHOTO = 'REGISTRATION_PHOTO';
const PHOTO_EXTENSIONS = ['jpg', 'jpeg', 'png'];
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

/** @returns {'type'|'size'|null} why the server would refuse, or null */
export function photoRejection(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!PHOTO_EXTENSIONS.includes(extension) || !PHOTO_TYPES.includes(file.type)) return 'type';
  if (file.size > MAX_SIZE_MB * 1024 * 1024) return 'size';
  return null;
}
