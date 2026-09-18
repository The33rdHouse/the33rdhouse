import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import {
  User,
  InsertUser,
  users, 
  userProgress, 
  InsertUserProgress,
  meditationSessions,
  InsertMeditationSession,
  audioMeditations,
  InsertAudioMeditation,
  forumPosts,
  InsertForumPost,
  forumComments,
  InsertForumComment,
  notifications,
  InsertNotification,
  emailSequences,
  InsertEmailSequence,
  emailSequenceEmails,
  InsertEmailSequenceEmail,
  userEmailQueue,
  InsertUserEmailQueue,
  emailLogs,
  InsertEmailLog,
  gates,
  InsertGate,
  realms,
  InsertRealm,
  innerCircleMonths,
  InsertInnerCircleMonth,
  innerCircleWeeks,
  InsertInnerCircleWeek,
  userInnerCircleProgress,
  chartographyBookings,
  InsertChartographyBooking,
  products,
  orders,
  orderItems
} from "../drizzle/schema";
// import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// Get user by session ID (for authentication)
export async function getUserBySessionId(sessionId: string): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    // For now, we'll use a simple session lookup
    // In production, you'd have a sessions table
    // For demo purposes, we'll check if sessionId matches a user's openId
    const result = await db.select().from(users).where(eq(users.openId, sessionId)).limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[Database] Error getting user by session:', error);
    return null;
  }
}

// Get user by email (for login)
export async function getUserByEmail(email: string): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[Database] Error getting user by email:', error);
    return null;
  }
}

// Get user by ID
export async function getUserById(userId: number): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[Database] Error getting user by ID:', error);
    return null;
  }
}

// Create user with email/password
export async function createUserWithPassword(data: {
  email: string;
  password: string;
  name: string;
}): Promise<User> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    // Check if user already exists
    const existing = await getUserByEmail(data.email);
    if (existing) {
      throw new Error('Email already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(data.password, 10);

    // Generate unique openId
    const openId = crypto.randomBytes(32).toString('hex');

    // Create user with password hash
    await db.insert(users).values({
      openId,
      email: data.email,
      name: data.name,
      loginMethod: 'email',
      passwordHash: hashedPassword,
      role: 'user',
    });

    const user = await getUserByEmail(data.email);
    if (!user) throw new Error('Failed to create user');

    return user;
  } catch (error) {
    console.error('[Database] Error creating user:', error);
    throw error;
  }
}

// Verify user password
export async function verifyUserPassword(email: string, password: string): Promise<User | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const user = await getUserByEmail(email);
    if (!user || !user.passwordHash) return null;

    // Verify password against stored hash
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) return null;

    return user;
  } catch (error) {
    console.error('[Database] Error verifying password:', error);
    return null;
  }
}

// Create session
export async function createSession(userId: number): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    // Get user
    const result = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = result[0];
    if (!user) throw new Error('User not found');

    // Return openId as session ID
    return user.openId;
  } catch (error) {
    console.error('[Database] Error creating session:', error);
    throw error;
  }
}

// Send welcome email via Gmail MCP
export async function sendWelcomeEmail(email: string, name: string): Promise<void> {
  try {
    const { sendWelcomeEmail: sendWelcome } = await import('./_core/email');
    await sendWelcome(email, name);
    console.log(`[Email] Welcome email sent successfully to ${email}`);
  } catch (error) {
    console.error('[Email] Error sending welcome email:', error);
    // Don't throw - email failure shouldn't block signup
  }
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === process.env.OWNER_OPEN_ID) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ============================================================================
// Gates Functions
// ============================================================================

export async function getAllGates() {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select().from(gates).orderBy(gates.orderIndex);
  return result;
}

export async function getGateById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(gates)
    .where(eq(gates.id, id))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function getGateByNumber(number: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(gates)
    .where(eq(gates.number, number))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function createGate(data: InsertGate) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(gates).values(data);
}

// ============================================================================
// Realms Functions
// ============================================================================

export async function getAllRealms() {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select().from(realms).orderBy(realms.orderIndex);
  return result;
}

export async function getRealmById(id: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(realms)
    .where(eq(realms.id, id))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function getRealmByNumber(number: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(realms)
    .where(eq(realms.number, number))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function getRealmsByGate(gateId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(realms)
    .where(eq(realms.gateId, gateId))
    .orderBy(realms.orderIndex);
  
  return result;
}

export async function createRealm(data: InsertRealm) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(realms).values(data);
}

// ============================================================================
// Inner Circle Functions
// ============================================================================

export async function getAllInnerCircleMonths() {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(innerCircleMonths)
    .orderBy(innerCircleMonths.monthNumber);
  
  return result;
}

export async function getInnerCircleMonth(monthNumber: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(innerCircleMonths)
    .where(eq(innerCircleMonths.monthNumber, monthNumber))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function getInnerCircleWeeks(monthId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(innerCircleWeeks)
    .where(eq(innerCircleWeeks.monthId, monthId))
    .orderBy(innerCircleWeeks.weekNumber);
  
  return result;
}

export async function createInnerCircleMonth(data: InsertInnerCircleMonth) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(innerCircleMonths).values(data);
  return result;
}

export async function createInnerCircleWeek(data: InsertInnerCircleWeek) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(innerCircleWeeks).values(data);
}

// ============================================================================
// Inner Circle Progress Functions
// ============================================================================

export async function getUserInnerCircleProgress(userId: number) {
  const db = await getDb();
  if (!db) return [];

  return await db
    .select()
    .from(userInnerCircleProgress)
    .where(eq(userInnerCircleProgress.userId, userId))
    .orderBy(userInnerCircleProgress.weekId);
}

export async function upsertUserInnerCircleProgress(data: {
  userId: number;
  monthId: number;
  weekId: number;
  completed: boolean;
  notes?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const completedAt = data.completed ? new Date() : null;
  const updateSet: {
    monthId: number;
    completed: boolean;
    completedAt: Date | null;
    updatedAt: Date;
    notes?: string | null;
  } = {
    monthId: data.monthId,
    completed: data.completed,
    completedAt,
    updatedAt: new Date(),
  };

  if (data.notes !== undefined) {
    updateSet.notes = data.notes;
  }

  await db
    .insert(userInnerCircleProgress)
    .values({
      userId: data.userId,
      monthId: data.monthId,
      weekId: data.weekId,
      completed: data.completed,
      completedAt,
      notes: data.notes ?? null,
    })
    .onDuplicateKeyUpdate({ set: updateSet });

  const result = await db
    .select()
    .from(userInnerCircleProgress)
    .where(
      and(
        eq(userInnerCircleProgress.userId, data.userId),
        eq(userInnerCircleProgress.weekId, data.weekId),
      ),
    )
    .limit(1);

  return result[0] ?? null;
}

// ============================================================================
// User Progress Functions
// ============================================================================

export async function getUserProgress(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select().from(userProgress).where(eq(userProgress.userId, userId));
  return result;
}

export async function getRealmProgress(userId: number, realmNumber: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(userProgress)
    .where(and(eq(userProgress.userId, userId), eq(userProgress.realmNumber, realmNumber)))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function upsertRealmProgress(data: InsertUserProgress) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .insert(userProgress)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        completed: data.completed,
        completedAt: data.completedAt,
        notes: data.notes,
        updatedAt: new Date(),
      },
    });
}

// ============================================================================
// Meditation Session Functions
// ============================================================================

export async function createMeditationSession(data: InsertMeditationSession) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(meditationSessions).values(data);
}

export async function getUserMeditationSessions(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(meditationSessions)
    .where(eq(meditationSessions.userId, userId))
    .orderBy(desc(meditationSessions.completedAt));
  
  return result;
}

export async function getRealmMeditationSessions(userId: number, realmNumber: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(meditationSessions)
    .where(
      and(
        eq(meditationSessions.userId, userId),
        eq(meditationSessions.realmNumber, realmNumber)
      )
    )
    .orderBy(desc(meditationSessions.completedAt));
  
  return result;
}

// ============================================================================
// Audio Meditation Functions
// ============================================================================

export async function createAudioMeditation(data: InsertAudioMeditation) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(audioMeditations).values(data);
}

export async function getAudioMeditation(realmNumber: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(audioMeditations)
    .where(eq(audioMeditations.realmNumber, realmNumber))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function getAllAudioMeditations() {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select().from(audioMeditations);
  return result;
}

// ============================================================================
// Forum Functions
// ============================================================================

export async function createForumPost(data: InsertForumPost) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(forumPosts).values(data);
  return result;
}

export async function getForumPosts(category?: string) {
  const db = await getDb();
  if (!db) return [];
  
  let query = db.select().from(forumPosts);
  
  if (category) {
    query = query.where(eq(forumPosts.category, category as any));
  }
  
  const result = await query.orderBy(desc(forumPosts.isPinned), desc(forumPosts.createdAt));
  return result;
}

export async function getForumPost(postId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const result = await db
    .select()
    .from(forumPosts)
    .where(eq(forumPosts.id, postId))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function createForumComment(data: InsertForumComment) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(forumComments).values(data);
}

export async function getForumComments(postId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(forumComments)
    .where(eq(forumComments.postId, postId))
    .orderBy(forumComments.createdAt);
  
  return result;
}

// ============================================================================
// Notifications
// ============================================================================

export async function getUserNotifications(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(50);
  
  return result;
}

export async function getUnreadNotificationCount(userId: number) {
  const db = await getDb();
  if (!db) return 0;
  
  const result = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  
  return result.length;
}

export async function markNotificationAsRead(notificationId: number, userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)));
}

export async function markAllNotificationsAsRead(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db
    .update(notifications)
    .set({ isRead: true, readAt: new Date() })
    .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
}

export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  if (data.userId) {
    // Single user notification
    await db.insert(notifications).values(data);
  } else {
    // Broadcast to all users
    const allUsers = await db.select().from(users);
    const notificationData = allUsers.map(user => ({
      ...data,
      userId: user.id,
    }));
    
    if (notificationData.length > 0) {
      await db.insert(notifications).values(notificationData);
    }
  }
}

// ============================================================================
// Email Sequences
// ============================================================================

export async function getAllEmailSequences() {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db.select().from(emailSequences);
  return result;
}

export async function getEmailSequence(sequenceId: number) {
  const db = await getDb();
  if (!db) return null;
  
  const sequence = await db
    .select()
    .from(emailSequences)
    .where(eq(emailSequences.id, sequenceId))
    .limit(1);
  
  if (sequence.length === 0) return null;
  
  const emails = await db
    .select()
    .from(emailSequenceEmails)
    .where(eq(emailSequenceEmails.sequenceId, sequenceId))
    .orderBy(emailSequenceEmails.delayDays);
  
  return {
    ...sequence[0],
    emails,
  };
}

export async function createEmailSequence(data: InsertEmailSequence) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const result = await db.insert(emailSequences).values(data);
  return result;
}

export async function createEmailSequenceEmail(data: InsertEmailSequenceEmail) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(emailSequenceEmails).values(data);
}

export async function queueUserEmail(data: InsertUserEmailQueue) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(userEmailQueue).values(data);
}

export async function logEmail(data: InsertEmailLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.insert(emailLogs).values(data);
}

export async function getUserEmailLogs(userId: number) {
  const db = await getDb();
  if (!db) return [];
  
  const result = await db
    .select()
    .from(emailLogs)
    .where(eq(emailLogs.userId, userId))
    .orderBy(desc(emailLogs.sentAt));
  
  return result;
}

// ============================================
// ADMIN FUNCTIONS
// ============================================

// Get all users (admin only)
export async function getAllUsers() {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db.select().from(users);
  } catch (error) {
    console.error('[Database] Error getting all users:', error);
    return [];
  }
}

// Get all meditation sessions (admin only)
export async function getAllMeditationSessions() {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db.select().from(meditationSessions);
  } catch (error) {
    console.error('[Database] Error getting all meditation sessions:', error);
    return [];
  }
}

// Get all progress records (admin only)
export async function getAllProgress() {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db.select().from(userProgress);
  } catch (error) {
    console.error('[Database] Error getting all progress:', error);
    return [];
  }
}

// ============================================
// STRIPE SUBSCRIPTION FUNCTIONS
// ============================================

// Update user's Stripe customer ID
export async function updateUserStripeCustomer(userId: number, stripeCustomerId: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    await db.update(users)
      .set({ stripeCustomerId })
      .where(eq(users.id, userId));
  } catch (error) {
    console.error('[Database] Error updating Stripe customer:', error);
    throw error;
  }
}

// Update user's subscription details
export async function updateUserSubscription(userId: number, data: {
  stripeSubscriptionId?: string | null;
  subscriptionTier?: 'free' | 'seeker' | 'initiate' | 'elder';
  subscriptionStatus?: 'active' | 'canceled' | 'past_due' | 'trialing';
  subscriptionEndsAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    await db.update(users)
      .set(data)
      .where(eq(users.id, userId));
  } catch (error) {
    console.error('[Database] Error updating subscription:', error);
    throw error;
  }
}

// Get user by Stripe subscription ID
export async function getUserByStripeSubscription(stripeSubscriptionId: string) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.select()
      .from(users)
      .where(eq(users.stripeSubscriptionId, stripeSubscriptionId))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[Database] Error getting user by subscription:', error);
    return null;
  }
}

// ============================================
// PORTAL ENTRY FUNCTIONS
// ============================================

// Update user's birth info
export async function updateUserBirthInfo(userId: number, data: {
  birthDate: string;
  birthTime: string;
  birthLocation: string;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    await db.update(users)
      .set(data)
      .where(eq(users.id, userId));
  } catch (error) {
    console.error('[Database] Error updating birth info:', error);
    throw error;
  }
}

// Sign portal documents
export async function signPortalDocuments(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    await db.update(users)
      .set({ 
        portalDocumentsSigned: true,
        portalCompletedAt: new Date()
      })
      .where(eq(users.id, userId));
  } catch (error) {
    console.error('[Database] Error signing portal documents:', error);
    throw error;
  }
}

// Update onboarding step
export async function updateOnboardingStep(userId: number, step: string) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    await db.update(users)
      .set({ onboardingStep: step })
      .where(eq(users.id, userId));
  } catch (error) {
    console.error('[Database] Error updating onboarding step:', error);
    throw error;
  }
}

// Complete onboarding
export async function completeOnboarding(userId: number) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    await db.update(users)
      .set({ 
        onboardingCompleted: true,
        onboardingCompletedAt: new Date()
      })
      .where(eq(users.id, userId));
  } catch (error) {
    console.error('[Database] Error completing onboarding:', error);
    throw error;
  }
}

// ============================================
// CHARTOGRAPHY BOOKINGS FUNCTIONS
// ============================================

// Create chartography booking
export async function createChartographyBooking(data: {
  userId: number;
  birthDate: string;
  birthTime: string;
  birthLocation: string;
  birthLatitude?: string | null;
  birthLongitude?: string | null;
  primaryQuestion?: string | null;
  focusAreas?: string | null;
  additionalNotes?: string | null;
  stripePaymentIntentId?: string | null;
  amount: number;
  status: 'pending' | 'paid' | 'scheduled' | 'completed' | 'canceled';
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    const [result] = await db.insert(chartographyBookings).values(data);
    return { id: result.insertId, ...data };
  } catch (error) {
    console.error('[Database] Error creating chartography booking:', error);
    throw error;
  }
}

// Get user's chartography bookings
export async function getChartographyBookings(userId: number) {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db.select()
      .from(chartographyBookings)
      .where(eq(chartographyBookings.userId, userId))
      .orderBy(desc(chartographyBookings.createdAt));
  } catch (error) {
    console.error('[Database] Error getting chartography bookings:', error);
    return [];
  }
}

// Get all chartography bookings (admin only)
export async function getAllChartographyBookings() {
  const db = await getDb();
  if (!db) return [];

  try {
    return await db.select()
      .from(chartographyBookings)
      .orderBy(desc(chartographyBookings.createdAt));
  } catch (error) {
    console.error('[Database] Error getting all chartography bookings:', error);
    return [];
  }
}

// Get single chartography booking
export async function getChartographyBooking(bookingId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.select()
      .from(chartographyBookings)
      .where(eq(chartographyBookings.id, bookingId))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[Database] Error getting chartography booking:', error);
    return null;
  }
}

// Update chartography booking status
export async function updateChartographyBookingStatus(
  bookingId: number,
  status: 'pending' | 'paid' | 'scheduled' | 'completed' | 'canceled'
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    await db.update(chartographyBookings)
      .set({ status })
      .where(eq(chartographyBookings.id, bookingId));
  } catch (error) {
    console.error('[Database] Error updating chartography booking status:', error);
    throw error;
  }
}

// Update chartography booking
export async function updateChartographyBooking(
  bookingId: number,
  data: {
    status?: 'pending' | 'paid' | 'scheduled' | 'completed' | 'canceled';
    scheduledFor?: Date | null;
    readingNotes?: string | null;
    readingDocument?: string | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    await db.update(chartographyBookings)
      .set(data)
      .where(eq(chartographyBookings.id, bookingId));
  } catch (error) {
    console.error('[Database] Error updating chartography booking:', error);
    throw error;
  }
}

// Send chartography confirmation email (placeholder - integrate with email service)
export async function sendChartographyConfirmationEmail(userId: number, bookingId: number) {
  // TODO: Integrate with email service (Gmail MCP or Resend)
  console.log(`[Email] Sending chartography confirmation to user ${userId} for booking ${bookingId}`);
  return true;
}

// ============================================
// PRODUCTS FUNCTIONS
// ============================================

// Get products by IDs
export async function getProductsByIds(productIds: number[]) {
  const db = await getDb();
  if (!db) return [];

  try {
    const result = await db.select()
      .from(products)
      .where(inArray(products.id, productIds));
    return result;
  } catch (error) {
    console.error('[Database] Error getting products by IDs:', error);
    return [];
  }
}

// Get product by ID
export async function getProductById(productId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.select()
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[Database] Error getting product by ID:', error);
    return null;
  }
}

// ============================================
// ORDERS FUNCTIONS
// ============================================

// Create order
export async function createOrder(data: {
  orderNumber: string;
  userId: number;
  stripePaymentIntentId?: string | null;
  stripeChargeId?: string | null;
  subtotal: number;
  tax?: number;
  shipping?: number;
  discount?: number;
  total: number;
  currency?: string;
  status?: 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'canceled' | 'refunded';
  paymentStatus?: 'pending' | 'paid' | 'failed' | 'refunded';
  fulfillmentStatus?: 'unfulfilled' | 'partial' | 'fulfilled';
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    const [result] = await db.insert(orders).values({
      ...data,
      tax: data.tax || 0,
      shipping: data.shipping || 0,
      discount: data.discount || 0,
      currency: data.currency || 'USD',
      status: data.status || 'pending',
      paymentStatus: data.paymentStatus || 'pending',
      fulfillmentStatus: data.fulfillmentStatus || 'unfulfilled',
    });
    return { id: result.insertId, ...data };
  } catch (error) {
    console.error('[Database] Error creating order:', error);
    throw error;
  }
}

// Get user's orders with items
export async function getUserOrders(userId: number) {
  const db = await getDb();
  if (!db) return [];

  try {
    const userOrders = await db.select()
      .from(orders)
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt));

    // Get order items for each order
    const ordersWithItems = await Promise.all(
      userOrders.map(async (order) => {
        const items = await db.select()
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));
        
        return {
          ...order,
          totalAmount: order.total,
          items: items.map(item => ({
            ...item,
            price: item.unitPrice,
          })),
        };
      })
    );

    return ordersWithItems;
  } catch (error) {
    console.error('[Database] Error getting user orders:', error);
    return [];
  }
}

// Get order by ID
export async function getOrderById(orderId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const result = await db.select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .limit(1);
    return result[0] || null;
  } catch (error) {
    console.error('[Database] Error getting order:', error);
    return null;
  }
}

// Create order item
export async function createOrderItem(data: {
  orderId: number;
  productId: number;
  productTitle: string;
  productSlug: string;
  productType?: string | null;
  productImage?: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  downloadUrl?: string | null;
  downloadLimit?: number;
  downloadExpiresAt?: Date | null;
}) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    const [result] = await db.insert(orderItems).values({
      ...data,
      downloadLimit: data.downloadLimit || -1,
    });
    return { id: result.insertId, ...data };
  } catch (error) {
    console.error('[Database] Error creating order item:', error);
    throw error;
  }
}

// Update order status
export async function updateOrderStatus(
  orderId: number,
  status: 'pending' | 'paid' | 'processing' | 'shipped' | 'delivered' | 'canceled' | 'refunded'
) {
  const db = await getDb();
  if (!db) throw new Error('Database not available');

  try {
    await db.update(orders)
      .set({ status })
      .where(eq(orders.id, orderId));
  } catch (error) {
    console.error('[Database] Error updating order status:', error);
    throw error;
  }
}
