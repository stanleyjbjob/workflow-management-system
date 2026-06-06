import { Module } from '@nestjs/common';
import { FormsService } from './forms.service';

/**
 * 表單與產出文件模組（2.3）：提供 FormsService。
 * - 自訂表單／欄位、掛載步驟、送出與簽核、步驟必填把關、跨步驟產出引用。
 * PrismaModule 為全域模組，已提供 PrismaService，故此處毋須再匯入。
 */
@Module({
  providers: [FormsService],
  exports: [FormsService],
})
export class FormsModule {}
