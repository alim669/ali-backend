/**
 * Friends Service - خدمة الأصدقاء
 */

import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Pool } = require("pg");

@Injectable()
export class FriendsService {
  private pool: any;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: false,
    });
    this.initTable();
  }

  private async initTable() {
    const client = await this.pool.connect();
    try {
      // جدول طلبات الصداقة
      await client.query(`
        CREATE TABLE IF NOT EXISTS friend_requests (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          from_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          to_user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          status VARCHAR(20) DEFAULT 'pending',
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(from_user_id, to_user_id)
        )
      `);

      // جدول الصداقات
      await client.query(`
        CREATE TABLE IF NOT EXISTS friendships (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user1_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          user2_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(user1_id, user2_id)
        )
      `);

      // فهرس للبحث السريع
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_friend_requests_to_user ON friend_requests(to_user_id, status);
        CREATE INDEX IF NOT EXISTS idx_friend_requests_from_user ON friend_requests(from_user_id, status);
        CREATE INDEX IF NOT EXISTS idx_friendships_user1 ON friendships(user1_id);
        CREATE INDEX IF NOT EXISTS idx_friendships_user2 ON friendships(user2_id);
      `);
    } catch (error) {
      console.error("Error initializing friends tables:", error);
    } finally {
      client.release();
    }
  }

  /**
   * إرسال طلب صداقة
   */
  async sendFriendRequest(fromUserId: string, toUserId: string) {
    console.log(`👥 sendFriendRequest: fromUserId=${fromUserId}, toUserId=${toUserId}`);
    
    if (fromUserId === toUserId) {
      throw new BadRequestException("لا يمكنك إرسال طلب صداقة لنفسك");
    }

    const client = await this.pool.connect();
    try {
      // التحقق أولاً من وجود المستخدم المستلم
      const receiverCheck = await client.query(
        `SELECT id FROM "User" WHERE id = $1`,
        [toUserId],
      );
      
      if (receiverCheck.rows.length === 0) {
        console.log(`❌ User not found: ${toUserId}`);
        throw new NotFoundException("المستخدم غير موجود");
      }
      
      // التحقق من عدم وجود صداقة مسبقة
      const existingFriendship = await client.query(
        `
        SELECT id FROM friendships 
        WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
      `,
        [fromUserId, toUserId],
      );

      if (existingFriendship.rows.length > 0) {
        throw new BadRequestException("أنتما أصدقاء بالفعل");
      }

      // التحقق من عدم وجود طلب معلق
      const existingRequest = await client.query(
        `
        SELECT id, status FROM friend_requests 
        WHERE from_user_id = $1 AND to_user_id = $2
      `,
        [fromUserId, toUserId],
      );

      if (existingRequest.rows.length > 0) {
        if (existingRequest.rows[0].status === "pending") {
          throw new BadRequestException("لديك طلب صداقة معلق بالفعل");
        }
      }

      // التحقق من طلب عكسي (الشخص الآخر أرسل طلب)
      const reverseRequest = await client.query(
        `
        SELECT id FROM friend_requests 
        WHERE from_user_id = $2 AND to_user_id = $1 AND status = 'pending'
      `,
        [fromUserId, toUserId],
      );

      if (reverseRequest.rows.length > 0) {
        // قبول الطلب العكسي تلقائياً
        return this.acceptFriendRequest(reverseRequest.rows[0].id, fromUserId);
      }

      // إنشاء طلب جديد
      const result = await client.query(
        `
        INSERT INTO friend_requests (from_user_id, to_user_id)
        VALUES ($1, $2)
        ON CONFLICT (from_user_id, to_user_id) 
        DO UPDATE SET status = 'pending', updated_at = NOW()
        RETURNING *
      `,
        [fromUserId, toUserId],
      );

      return {
        success: true,
        message: "تم إرسال طلب الصداقة بنجاح",
        data: result.rows[0],
      };
    } finally {
      client.release();
    }
  }

  /**
   * إرسال طلب صداقة بالـ Custom ID
   */
  async sendFriendRequestByCustomId(fromUserId: string, customId: number) {
    const client = await this.pool.connect();
    try {
      // البحث عن المستخدم بالـ Custom ID
      const userResult = await client.query(
        `
        SELECT id FROM "User" WHERE "numericId" = $1
      `,
        [customId],
      );

      if (userResult.rows.length === 0) {
        throw new NotFoundException("لم يتم العثور على مستخدم بهذا الـ ID");
      }

      const toUserId = userResult.rows[0].id;
      return this.sendFriendRequest(fromUserId, toUserId);
    } finally {
      client.release();
    }
  }

  /**
   * قبول طلب الصداقة
   */
  async acceptFriendRequest(requestId: string, userId: string) {
    const client = await this.pool.connect();
    try {
      // جلب الطلب
      const requestResult = await client.query(
        `
        SELECT * FROM friend_requests WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
      `,
        [requestId, userId],
      );

      if (requestResult.rows.length === 0) {
        throw new NotFoundException("طلب الصداقة غير موجود");
      }

      const request = requestResult.rows[0];

      // بدء transaction
      await client.query("BEGIN");

      // تحديث حالة الطلب
      await client.query(
        `
        UPDATE friend_requests SET status = 'accepted', updated_at = NOW() WHERE id = $1
      `,
        [requestId],
      );

      // إنشاء الصداقة
      await client.query(
        `
        INSERT INTO friendships (user1_id, user2_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
        [request.from_user_id, request.to_user_id],
      );

      await client.query("COMMIT");

      return {
        success: true,
        message: "تم قبول طلب الصداقة",
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * رفض طلب الصداقة
   */
  async rejectFriendRequest(requestId: string, userId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        UPDATE friend_requests 
        SET status = 'rejected', updated_at = NOW() 
        WHERE id = $1 AND to_user_id = $2 AND status = 'pending'
        RETURNING *
      `,
        [requestId, userId],
      );

      if (result.rows.length === 0) {
        throw new NotFoundException("طلب الصداقة غير موجود");
      }

      return {
        success: true,
        message: "تم رفض طلب الصداقة",
      };
    } finally {
      client.release();
    }
  }

  /**
   * جلب قائمة الأصدقاء
   */
  async getFriends(userId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT 
          f.id as friendship_id,
          CASE 
            WHEN f.user1_id = $1 THEN f.user2_id 
            ELSE f.user1_id 
          END as friend_id,
          u.username,
          u."displayName" as name,
          u.avatar,
          u."numericId" as custom_id,
          u.status = 'ACTIVE' as is_online,
          f.created_at
        FROM friendships f
        JOIN "User" u ON u.id = CASE 
          WHEN f.user1_id = $1 THEN f.user2_id 
          ELSE f.user1_id 
        END
        WHERE f.user1_id = $1 OR f.user2_id = $1
        ORDER BY u."displayName"
      `,
        [userId],
      );

      return {
        success: true,
        data: result.rows,
      };
    } finally {
      client.release();
    }
  }

  /**
   * جلب طلبات الصداقة المعلقة (الواردة)
   */
  async getPendingRequests(userId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT 
          fr.id as request_id,
          fr.from_user_id,
          fr.created_at,
          u.username,
          u."displayName" as display_name,
          u.avatar as photo_url,
          u."numericId" as custom_id
        FROM friend_requests fr
        JOIN "User" u ON u.id = fr.from_user_id
        WHERE fr.to_user_id = $1 AND fr.status = 'pending'
        ORDER BY fr.created_at DESC
      `,
        [userId],
      );

      return {
        success: true,
        data: result.rows.map((row: any) => ({
          requestId: row.request_id,
          fromUserId: row.from_user_id,
          displayName: row.display_name || row.username,
          photoUrl: row.photo_url,
          customId: row.custom_id,
          createdAt: row.created_at,
        })),
      };
    } finally {
      client.release();
    }
  }

  /**
   * جلب طلبات الصداقة المرسلة
   */
  async getSentRequests(userId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT 
          fr.id as request_id,
          fr.to_user_id,
          fr.status,
          fr.created_at,
          u.username,
          u."displayName" as display_name,
          u.avatar as photo_url,
          u."numericId" as custom_id
        FROM friend_requests fr
        JOIN "User" u ON u.id = fr.to_user_id
        WHERE fr.from_user_id = $1
        ORDER BY fr.created_at DESC
      `,
        [userId],
      );

      return {
        success: true,
        data: result.rows,
      };
    } finally {
      client.release();
    }
  }

  /**
   * إزالة صديق
   */
  async removeFriend(userId: string, friendId: string) {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        DELETE FROM friendships 
        WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
        RETURNING *
      `,
        [userId, friendId],
      );

      if (result.rows.length === 0) {
        throw new NotFoundException("الصداقة غير موجودة");
      }

      return {
        success: true,
        message: "تم إزالة الصديق",
      };
    } finally {
      client.release();
    }
  }

  /**
   * التحقق من الصداقة
   */
  async areFriends(userId1: string, userId2: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `
        SELECT id FROM friendships 
        WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)
      `,
        [userId1, userId2],
      );

      return result.rows.length > 0;
    } finally {
      client.release();
    }
  }
}
