import { type Permission, PermissionError } from './Permission';

export const READ_ONLY_ERROR = 'Cannot modify data';

export const ReadOnly: Permission<unknown, unknown> = {
  validateWriteSpec() {
    throw new PermissionError(READ_ONLY_ERROR);
  },

  validateWrite() {
    throw new PermissionError(READ_ONLY_ERROR);
  },
};
