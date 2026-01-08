/**
 * Ali Backend - Security Module
 * وحدة الأمان الشاملة للتطبيق
 */
import { Module, Global } from "@nestjs/common";
import { SecurityService } from "./security.service";
import { IpBlockGuard } from "./guards/ip-block.guard";
import { BruteForceGuard } from "./guards/brute-force.guard";
import { SecurityMiddleware } from "./middleware/security.middleware";

@Global()
@Module({
  providers: [
    SecurityService,
    IpBlockGuard,
    BruteForceGuard,
    SecurityMiddleware,
  ],
  exports: [SecurityService, IpBlockGuard, BruteForceGuard, SecurityMiddleware],
})
export class SecurityModule {}
