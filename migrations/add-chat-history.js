// Enhanced migration: migrations/add-chat-history.js
import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

// Migration tracking schema
const MigrationSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  executedAt: { type: Date, default: Date.now },
  version: { type: String, required: true },    
  rollbackData: mongoose.Schema.Types.Mixed
});

async function migrateChatHistory() {
  const migrationName = 'add-chat-history-v1';
  const migrationVersion = '1.0.0';
  
  try {
    console.log('🚀 Starting chat history migration...');
    
    // Connect to database with proper options
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 1, // Use minimal connections for migration
      serverSelectionTimeoutMS: 5000
    });

    console.log('✅ Connected to MongoDB for migration');

    // Create Migration model
    const Migration = mongoose.model('Migration', MigrationSchema);

    // Check if migration already executed
    const existingMigration = await Migration.findOne({ name: migrationName });
    if (existingMigration) {
      console.log('⚠️  Migration already executed on:', existingMigration.executedAt);
      console.log('   Skipping migration...');
      return;
    }

    // Start transaction for atomic migration
    const session = await mongoose.startSession();
    
    await session.withTransaction(async () => {
      console.log('📝 Starting migration transaction...');
      
      // Get collections
      const ChatSession = mongoose.connection.collection('chatsessions');
      const User = mongoose.connection.collection('users');

      // Check collections exist
      const collections = await mongoose.connection.db.listCollections().toArray();
      const collectionNames = collections.map(c => c.name);
      
      console.log('📊 Existing collections:', collectionNames);

      let updateCount = 0;
      let indexCount = 0;

      // Update existing ChatSession documents
      if (collectionNames.includes('chatsessions')) {
        console.log('📝 Updating existing chat sessions...');
        
        // Add missing fields with proper defaults
        const updateResult = await ChatSession.updateMany(
          { 
            $or: [
              { lastReadAt: { $exists: false } },
              { isActive: { $exists: false } },
              { sessionType: { $exists: false } }
            ]
          },
          {
            $set: {
              lastReadAt: new Date(),
              isActive: true
            },
            $setOnInsert: {
              sessionType: 'study',
              duration: 0,
              totalTokens: 0,
              cost: 0
            }
          },
          { session }
        );
        
        updateCount = updateResult.modifiedCount;
        console.log(`✅ Updated ${updateCount} existing chat sessions`);
        
        // Store rollback data
        const rollbackData = {
          updatedSessions: updateCount,
          timestamp: new Date()
        };

        // Record migration before creating indexes
        await Migration.create([{
          name: migrationName,
          executedAt: new Date(),
          version: migrationVersion,
          rollbackData
        }], { session });

      } else {
        console.log('📝 ChatSession collection will be created on first use');
        
        // Record migration for new installation
        await Migration.create([{
          name: migrationName,
          executedAt: new Date(),
          version: migrationVersion,
          rollbackData: { newInstallation: true }
        }], { session });
      }
    });

    console.log('✅ Transaction completed successfully');

    // Create indexes outside transaction for better performance
    console.log('🔍 Creating database indexes...');
    
    const ChatSession = mongoose.connection.collection('chatsessions');
    
    // Define all required indexes
    const indexes = [
      {
        spec: { userId: 1, createdAt: -1 },
        name: 'userId + createdAt (primary lookup)'
      },
      {
        spec: { userId: 1, updatedAt: -1 },
        name: 'userId + updatedAt (recent activity)'
      },
      {
        spec: { userId: 1, subject: 1 },
        name: 'userId + subject (filtering)'
      },
      {
        spec: { userId: 1, sessionType: 1 },
        name: 'userId + sessionType (type filtering)'
      },
      {
        spec: { userId: 1, subject: 1, createdAt: -1 },
        name: 'compound filtering index'
      },
      {
        spec: { userId: 1, lastReadAt: -1 },
        name: 'userId + lastReadAt (read status)'
      }
    ];

    // Create regular indexes
    for (const { spec, name } of indexes) {
      try {
        await ChatSession.createIndex(spec);
        console.log(`✅ Created ${name} index`);
        indexCount++;
      } catch (error) {
        if (error.code === 11000 || error.codeName === 'IndexOptionsConflict') {
          console.log(`⚠️  ${name} index already exists`);
        } else {
          console.warn(`⚠️  Failed to create ${name} index:`, error.message);
        }
      }
    }

    // Handle text search index separately (only one allowed per collection)
    try {
      const existingIndexes = await ChatSession.listIndexes().toArray();
      const hasTextIndex = existingIndexes.some(idx => 
        idx.key && Object.values(idx.key).includes('text')
      );

      if (!hasTextIndex) {
        await ChatSession.createIndex({
          'messages.content': 'text',
          subject: 'text'
        }, {
          name: 'content_search_index',
          background: true,
          textIndexVersion: 3
        });
        console.log('✅ Created text search index');
        indexCount++;
      } else {
        console.log('⚠️  Text search index already exists');
      }
    } catch (error) {
      console.warn('⚠️  Failed to create text search index:', error.message);
    }

    // Create TTL index for automatic cleanup (optional)
    try {
      await ChatSession.createIndex(
        { createdAt: 1 },
        { 
          expireAfterSeconds: 180 * 24 * 60 * 60, // 180 days
          name: 'auto_cleanup_ttl',
          background: true
        }
      );
      console.log('✅ Created TTL index for automatic cleanup (180 days)');
      indexCount++;
    } catch (error) {
      if (error.codeName !== 'IndexOptionsConflict') {
        console.warn('⚠️  Failed to create TTL index:', error.message);
      } else {
        console.log('⚠️  TTL index already exists');
      }
    }

    // Update user schema if needed (for new stats fields)
    const User = mongoose.connection.collection('users');
    try {
      const userUpdateResult = await User.updateMany(
        {
          $or: [
            { 'stats.bestStreak': { $exists: false } },
            { 'stats.quizzesCompleted': { $exists: false } }
          ]
        },
        {
          $set: {
            'stats.bestStreak': 0,
            'stats.quizzesCompleted': 0
          }
        }
      );
      
      if (userUpdateResult.modifiedCount > 0) {
        console.log(`✅ Updated ${userUpdateResult.modifiedCount} user records with new stat fields`);
      }
    } catch (error) {
      console.warn('⚠️  Failed to update user stats:', error.message);
    }

    console.log('\n🎉 Chat history migration completed successfully!');
    console.log('\n📊 Migration Summary:');
    console.log(`   - Updated chat sessions: ${updateCount}`);
    console.log(`   - Created indexes: ${indexCount}`);
    console.log('   - Added support for:');
    console.log('     • Chat history search and filtering');
    console.log('     • Session management and tracking');
    console.log('     • Performance optimized queries');
    console.log('     • Automatic cleanup after 180 days');
    console.log('     • Text search in messages and subjects');
    
    console.log('\n💡 Next steps:');
    console.log('   1. Restart your application server');
    console.log('   2. Test chat history functionality');
    console.log('   3. Monitor performance with new indexes');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.error('Stack trace:', error.stack);
    
    // Log rollback information
    console.log('\n🔄 To rollback this migration:');
    console.log('   1. Drop the created indexes manually');
    console.log('   2. Remove added fields from documents');
    console.log('   3. Delete migration record from migrations collection');
    
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

// Rollback function
async function rollbackMigration() {
  try {
    console.log('🔄 Starting rollback...');
    
    await mongoose.connect(process.env.MONGODB_URI);
    
    const Migration = mongoose.model('Migration', MigrationSchema);
    const migration = await Migration.findOne({ name: 'add-chat-history-v1' });
    
    if (!migration) {
      console.log('No migration found to rollback');
      return;
    }

    const ChatSession = mongoose.connection.collection('chatsessions');
    
    // Remove added fields
    await ChatSession.updateMany(
      {},
      {
        $unset: {
          lastReadAt: "",
          isActive: ""
        }
      }
    );

    // Remove migration record
    await Migration.deleteOne({ name: 'add-chat-history-v1' });
    
    console.log('✅ Rollback completed');
    
  } catch (error) {
    console.error('❌ Rollback failed:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

// Command line interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  if (command === 'rollback') {
    rollbackMigration();
  } else {
    migrateChatHistory();
  }
}

export { migrateChatHistory, rollbackMigration };
