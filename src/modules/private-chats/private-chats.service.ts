/**
 * Private Chats Service - خدمة الدردشة الخاصة
 */

import { Injectable, NotFoundException, ForbiddenException, OnModuleInit } from "@nestjs/common";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pool } = require("pg");

@Injectable()
export class PrivateChatsService implements OnModuleInit {
  private pool: any;

  constructor() {
    const dbUrl = process.env.DATABASE_URL || '';
    const requireSSL = dbUrl.includes('sslmode=require') || dbUrl.includes('neon.tech');
    
    this.pool = new Pool({
      connectionString: dbUrl,
      ssl: requireSSL ? { rejectUnauthorized: false } : false,
    });
  }

  async onModuleInit() {
    await this.initTables();
  }

  private async initTables() {
    const client = await this.pool.connect();
    try {
      // جدول المحادثات الخاصة
      await client.query(`
        CREATE TABLE IF NOT EXISTS private_chats (
          id VARCHAR(255) PRIMARY KEY,
          user1_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          user2_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          last_message_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // جدول الرسائل الخاصة
      await client.query(`
        CREATE TABLE IF NOT EXISTS private_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          chat_id VARCHAR(255) NOT NULL REFERENCES private_chats(id) ON DELETE CASCADE,
          sender_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          text TEXT NOT NULL,
          type VARCHAR(20) DEFAULT 'text',
          image_url TEXT,
          duration VARCHAR(20),
          is_read BOOLEAN DEFAULT false,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Indexes for better performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_private_messages_chat_id ON private_messages(chat_id);
        CREATE INDEX IF NOT EXISTS idx_private_messages_created_at ON private_messages(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_private_chats_users ON private_chats(user1_id, user2_id);
      `);

      console.log("Private chats tables initialized successfully");
    } catch (error) {
      console.error("Error initializing private chats tables:", error);
    } finally {
      client.release();
    }
  }

  /**
   * توليد معرف المحادثة الخاصة (موحد بغض النظر عن الترتيب)
   */
  getChatId(userId1: string, userId2: string): string {
    const ids = [userId1, userId2].sort();
    return `chat_${ids[0]}_${ids[1]}`;
  }

  /**
   * التحقق من أن المستخدمين أصدقاء
   */
  async areFriends(userId1: string, userId2: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT 1 FROM friendships 
        WHERE (user1_id = $1 AND user2_id = $2) 
           OR (user1_id = $2 AND user2_id = $1)
        LIMIT 1
        `,
        [userId1, userId2]
      );
      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }

  /**
   * إرسال رسالة خاصة
   */
  async sendMessage(
    fromUserId: string,
    toUserId: string,
    text: string,
    type: string = "text",
    imageUrl?: string,
    duration?: string
  ) {
    // التحقق من أنهم أصدقاء
    const friends = await this.areFriends(fromUserId, toUserId);
    if (!friends) {
      throw new ForbiddenException("يجب أن تكونا أصدقاء لإرسال رسائل خاصة");
    }

    const chatId = this.getChatId(fromUserId, toUserId);
    const client = await this.pool.connect();

    try {
      // إنشاء المحادثة إذا لم تكن موجودة
      await client.query(
        `
        INSERT INTO private_chats (id, user1_id, user2_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
        `,
        [chatId, fromUserId, toUserId]
      );

      // إضافة الرسالة
      const result = await client.query(
        `
        INSERT INTO private_messages (chat_id, sender_id, text, type, image_url, duration)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, chat_id, sender_id, text, type, image_url, duration, is_read, created_at
        `,
        [chatId, fromUserId, text, type, imageUrl, duration]
      );

      // تحديث وقت آخر رسالة في المحادثة
      await client.query(
        `
        UPDATE private_chats SET last_message_at = NOW(), updated_at = NOW()
        WHERE id = $1
        `,
        [chatId]
      );

      const message = result.rows[0];
      return {
        success: true,
        data: {
          id: message.id,
          chatId: message.chat_id,
          senderId: message.sender_id,
          text: message.text,
          type: message.type,
          imageUrl: message.image_url,
          duration: message.duration,
          isRead: message.is_read,
          createdAt: message.created_at,
        },
      };
    } finally {
      client.release();
    }
  }

  /**
   * جلب رسائل المحادثة
   */
  async getMessages(chatId: string, userId: string, limit: number = 100, before?: string) {
    const client = await this.pool.connect();

    try {
      // التحقق من أن المستخدم جزء من المحادثة
      const chatCheck = await client.query(
        `SELECT 1 FROM private_chats WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
        [chatId, userId]
      );

      if (chatCheck.rows.length === 0) {
        throw new ForbiddenException("لا يمكنك الوصول لهذه المحادثة");
      }

      let query = `
        SELECT 
          pm.id, pm.chat_id, pm.sender_id, pm.text, pm.type, 
          pm.image_url, pm.duration, pm.is_read, pm.created_at,
          u."displayName" as sender_name, u.avatar as sender_avatar
        FROM private_messages pm
        JOIN "User" u ON u.id = pm.sender_id
        WHERE pm.chat_id = $1
      `;

      const params: any[] = [chatId];

      if (before) {
        query += ` AND pm.created_at < $2`;
        params.push(before);
      }

      query += ` ORDER BY pm.created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await client.query(query, params);

      return {
        success: true,
        data: result.rows.map((m: any) => ({
          id: m.id,
          chatId: m.chat_id,
          senderId: m.sender_id,
          senderName: m.sender_name,
          senderAvatar: m.sender_avatar,
          text: m.text,
          type: m.type,
          imageUrl: m.image_url,
          duration: m.duration,
          isRead: m.is_read,
          createdAt: m.created_at,
        })),
      };
    } finally {
      client.release();
    }
  }

  /**
   * تحديد الرسائل كمقروءة
   */
  async markAsRead(chatId: string, userId: string) {
    const client = await this.pool.connect();

    try {
      await client.query(
        `
        UPDATE private_messages 
        SET is_read = true 
        WHERE chat_id = $1 AND sender_id != $2 AND is_read = false
        `,
        [chatId, userId]
      );

      return { success: true };
    } finally {
      client.release();
    }
  }

  /**
   * جلب قائمة المحادثات
   */
  async getChats(userId: string) {
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `
        SELECT 
          pc.id as chat_id,
          pc.last_message_at,
          CASE 
            WHEN pc.user1_id = $1 THEN pc.user2_id 
            ELSE pc.user1_id 
          END as other_user_id,
          u."displayName" as other_user_name,
          u.avatar as other_user_avatar,
          v.type as other_user_verification_type,
          false as other_user_online,
          (
            SELECT COUNT(*) FROM private_messages pm 
            WHERE pm.chat_id = pc.id AND pm.sender_id != $1 AND pm.is_read = false
          ) as unread_count,
          (
            SELECT text FROM private_messages pm 
            WHERE pm.chat_id = pc.id 
            ORDER BY pm.created_at DESC LIMIT 1
          ) as last_message
        FROM private_chats pc
        JOIN "User" u ON u.id = CASE WHEN pc.user1_id = $1 THEN pc.user2_id ELSE pc.user1_id END
        LEFT JOIN "Verification" v ON v."userId" = u.id AND v."expiresAt" > NOW()
        WHERE pc.user1_id = $1 OR pc.user2_id = $1
        ORDER BY pc.last_message_at DESC NULLS LAST
        `,
        [userId]
      );

      return {
        success: true,
        data: result.rows.map((c: any) => ({
          chatId: c.chat_id,
          otherUserId: c.other_user_id,
          otherUserName: c.other_user_name,
          otherUserAvatar: c.other_user_avatar,
          otherUserVerificationType: c.other_user_verification_type,
          otherUserOnline: c.other_user_online,
          unreadCount: parseInt(c.unread_count) || 0,
          lastMessage: c.last_message,
          lastMessageAt: c.last_message_at,
        })),
      };
    } finally {
      client.release();
    }
  }

  /**
   * عدد الرسائل غير المقروءة للمحادثة
   */
  async getUnreadCount(chatId: string, userId: string): Promise<number> {
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `
        SELECT COUNT(*) as count FROM private_messages 
        WHERE chat_id = $1 AND sender_id != $2 AND is_read = false
        `,
        [chatId, userId]
      );
      return parseInt(result.rows[0]?.count) || 0;
    } finally {
      client.release();
    }
  }

  /**
   * إجمالي الرسائل غير المقروءة
   */
  async getTotalUnreadCount(userId: string): Promise<number> {
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `
        SELECT COUNT(*) as count FROM private_messages pm
        JOIN private_chats pc ON pc.id = pm.chat_id
        WHERE (pc.user1_id = $1 OR pc.user2_id = $1)
          AND pm.sender_id != $1 
          AND pm.is_read = false
        `,
        [userId]
      );
      return parseInt(result.rows[0]?.count) || 0;
    } finally {
      client.release();
    }
  }

  /**
   * حذف محادثة
   */
  async deleteChat(chatId: string, userId: string) {
    const client = await this.pool.connect();

    try {
      // التحقق من أن المستخدم جزء من المحادثة
      const chatCheck = await client.query(
        `SELECT 1 FROM private_chats WHERE id = $1 AND (user1_id = $2 OR user2_id = $2)`,
        [chatId, userId]
      );

      if (chatCheck.rows.length === 0) {
        throw new ForbiddenException("لا يمكنك حذف هذه المحادثة");
      }

      await client.query(`DELETE FROM private_messages WHERE chat_id = $1`, [chatId]);
      await client.query(`DELETE FROM private_chats WHERE id = $1`, [chatId]);

      return { success: true, message: "تم حذف المحادثة" };
    } finally {
      client.release();
    }
  }

  /**
   * حذف رسالة
   */
  async deleteMessage(chatId: string, messageId: string, userId: string) {
    const client = await this.pool.connect();

    try {
      const result = await client.query(
        `
        DELETE FROM private_messages 
        WHERE id = $1 AND chat_id = $2 AND sender_id = $3
        RETURNING id
        `,
        [messageId, chatId, userId]
      );

      if (result.rows.length === 0) {
        throw new NotFoundException("الرسالة غير موجودة أو لا يمكنك حذفها");
      }

      return { success: true, message: "تم حذف الرسالة" };
    } finally {
      client.release();
    }
  }
}
