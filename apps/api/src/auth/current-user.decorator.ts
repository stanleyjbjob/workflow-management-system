import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { SessionUser } from './auth.service';

/**
 * 取出經 SessionAuthGuard 驗證後掛在 request 上的目前使用者。
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser => {
    const req = ctx.switchToHttp().getRequest<{ user: SessionUser }>();
    return req.user;
  },
);
