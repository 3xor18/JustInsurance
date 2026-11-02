import { AppConfig } from './config/config.mjs';

export { DeskError } from './domain/errors.mjs';

export const actors = AppConfig.get().security.identities;
