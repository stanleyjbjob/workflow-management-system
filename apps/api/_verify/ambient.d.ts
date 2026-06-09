// Ambient stubs so apps/api/src can be typechecked WITHOUT installing NestJS/node deps.
// Non-Prisma deps are intentionally `any`; ONLY @prisma/client (via tsconfig.verify.json paths)
// is strictly typed by the generated field-accurate stub. typecheck-only, never built/shipped.
type Buffer = any;
declare module '@nestjs/common';
declare module '@nestjs/common/*';
declare module '@nestjs/core';
declare module '@nestjs/core/*';
declare module '@nestjs/schedule';
declare module '@nestjs/platform-express';
declare module '@nestjs/testing';
declare module 'nodemailer';
declare module 'rxjs';
declare module 'rxjs/*';
declare module 'reflect-metadata';
declare module 'crypto';
declare module 'node:crypto';
declare module 'path';
declare module 'node:path';
declare module 'fs';
declare module 'node:fs';
declare module 'express';
declare var process: any;
declare var console: any;
declare var Buffer: any;
declare var URL: any;
declare var URLSearchParams: any;
declare var global: any;
declare function setTimeout(...a: any[]): any;
declare function clearTimeout(...a: any[]): any;
declare function setInterval(...a: any[]): any;
declare function clearInterval(...a: any[]): any;
declare function fetch(...a: any[]): Promise<any>;
declare function require(s: string): any;
declare var __dirname: string;
declare var module: any;
