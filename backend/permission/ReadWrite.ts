import type { Permission } from './Permission';

export const ReadWrite: Permission<unknown, unknown> = {
  validateWrite() {
    // nothing to do
  },
};
