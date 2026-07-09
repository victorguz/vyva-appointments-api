import { Injectable } from '@nestjs/common';

import { User } from '../../schemas/user.schema';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';

interface FilesUploadLinkData {
  uploadUrl: string;
  url: string;
  route: string;
  fileName: string;
}

interface FilesSaveData {
  url: string;
  route: string;
  fileName: string;
}

@Injectable()
export class WhatsAppMediaFilesService {
  constructor(private readonly lambdaInvoke: LambdaInvokeService) {}

  async uploadConversationMedia(
    user: User,
    idConversation: string,
    fileName: string,
    mimeType: string,
    buffer: Buffer,
  ): Promise<{ url: string; route: string; fileName: string }> {
    const folderPath = `whatsapp/conversations/${idConversation}`;
    const uploadFileName = `${folderPath}/${Date.now()}_${fileName}`;

    const linkResponse = await this.lambdaInvoke.invokeFunction(
      'vyva-files',
      'POST',
      '/api/files/upload-link',
      {
        fileName: uploadFileName,
        folder: 'private',
        mimeType,
        size: buffer.length,
      },
      user,
    );

    const linkData = linkResponse?.data as FilesUploadLinkData | undefined;
    if (!linkResponse?.success || !linkData?.uploadUrl || !linkData.route) {
      throw new Error('Could not get upload link for WhatsApp media');
    }

    const uploadRes = await fetch(linkData.uploadUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': mimeType,
      },
      body: buffer,
    });

    if (!uploadRes.ok) {
      throw new Error(`S3 upload failed with status ${uploadRes.status}`);
    }

    const saveResponse = await this.lambdaInvoke.invokeFunction(
      'vyva-files',
      'POST',
      '/api/files/save',
      {
        fileName: linkData.fileName || fileName,
        route: linkData.route,
        folder: 'private',
        mimeType,
        size: buffer.length,
      },
      user,
    );

    const saveData = saveResponse?.data as FilesSaveData | undefined;
    const url = saveData?.url?.trim() || linkData.url?.trim();
    if (!url) {
      throw new Error('Could not resolve uploaded WhatsApp media URL');
    }

    return {
      url,
      route: linkData.route,
      fileName: saveData?.fileName || linkData.fileName || fileName,
    };
  }
}
