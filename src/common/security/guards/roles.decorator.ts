/**
 * Roles Decorator - ديكوريتور تحديد الأدوار المطلوبة
 */

import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";

export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
