const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

// Initialize express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
});

// Function to send event notifications
async function sendNotification(event) {
    try {
        const usersSnapshot = await admin.firestore()
            .collection('users')
            .where('fcmToken', '!=', null)
            .where('isLoggedIn', '==', true)
            .get();

        console.log('\n👥 Found users:', usersSnapshot.size);
        
        const tokens = usersSnapshot.docs
            .map(doc => doc.data().fcmToken)
            .filter(token => token);

        if (tokens.length === 0) {
            console.log('No active users found');
            return;
        }

        const expandedBody = [
            event.description.substring(0, 60) + (event.description.length > 60 ? '...' : ''),
            `📅 ${event.date} at ${event.time}`,
            `⏰ Register by: ${event.registrationDeadline}`,
            '🔗 Tap to register'
        ].join('\n');

        const message = {
            notification: {
                title: `New Event: ${event.title}`,
                body: expandedBody
            },
            data: {
                eventId: event.id,
                title: event.title,
                description: event.description,
                imageUrl: event.imageRes || '',
                date: event.date || '',
                time: event.time || '',
                registrationDeadline: event.registrationDeadline || '',
                formLink: event.formLink || '',
                clickAction: "OPEN_EVENT_LINK"
            },
            android: {
                priority: 'high',
                notification: {
                    icon: 'default',
                    color: '#FF5722',
                    defaultSound: true,
                    channelId: 'events_channel',
                    visibility: 'public',
                    priority: 'high'
                }
            },
            tokens: tokens
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`✅ Notification sent: Success: ${response.successCount}, Failed: ${response.failureCount}`);
    } catch (error) {
        console.error('Error sending notification:', error);
    }
}

// Function to send update notifications
async function sendUpdateNotification(release) {
    try {
        const usersSnapshot = await admin.firestore()
            .collection('users')
            .where('fcmToken', '!=', null)
            .where('isLoggedIn', '==', true)
            .get();

        const tokens = usersSnapshot.docs
            .map(doc => doc.data().fcmToken)
            .filter(token => token);

        if (tokens.length === 0) {
            console.log('No active users found');
            return;
        }

        const message = {
            notification: {
                title: `🚀 New Update Available: ${release.tag_name}`,
                body: `${release.name || 'New version available!'}\n\nTap to update.`
            },
            data: {
                type: "APP_UPDATE",
                version: release.tag_name,
                releaseNotes: release.body || 'No release notes available',
                downloadUrl: release.assets[0]?.browser_download_url || '',
                action: "UPDATE_APP"
            },
            android: {
                priority: 'high',
                notification: {
                    icon: 'default',
                    color: '#FF5722',
                    channelId: 'updates_channel',
                    priority: 'max',
                    defaultSound: true,
                    clickAction: "UPDATE_APP"
                }
            },
            tokens: tokens
        };

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`✅ Update notification sent to ${response.successCount} users`);
    } catch (error) {
        console.error('Error sending update notification:', error);
    }
}

// Listen for new events in Firestore
const eventsRef = admin.firestore().collection('events');
eventsRef.onSnapshot(snapshot => {
    snapshot.docChanges().forEach(change => {
        if (change.type === 'added') {
            const event = {
                id: change.doc.id,
                ...change.doc.data()
            };
            console.log('\n📝 New event detected:', event.title);
            sendNotification(event);
        }
    });
}, error => {
    console.error('Error listening to events:', error);
});

// GitHub webhook endpoint
app.post('/github-webhook', async (req, res) => {
    console.log('\n🎯 Webhook received');
    const event = req.headers['x-github-event'];
    
    try {
        if (event === 'release' && req.body.action === 'published') {
            console.log('\n✨ Valid release event detected');
            
            if (!req.body.release || !req.body.release.tag_name) {
                return res.status(400).json({
                    success: false,
                    error: 'Missing required release data'
                });
            }

            await sendUpdateNotification(req.body.release);
            console.log('✅ Notification process completed');
        }

        return res.status(200).json({
            success: true,
            message: "Webhook processed"
        });
    } catch (error) {
        console.error('\n❌ Error processing webhook:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test endpoints
app.get('/test', (req, res) => {
    try {
        return res.status(200).json({
            success: true,
            message: "Test endpoint working!"
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

app.get('/check-tokens', async (req, res) => {
    try {
        const usersSnapshot = await admin.firestore()
            .collection('users')
            .get();

        const users = usersSnapshot.docs.map(doc => ({
            userId: doc.id,
            email: doc.data().email,
            fcmToken: doc.data().fcmToken,
            isLoggedIn: doc.data().isLoggedIn
        }));

        console.log('\n📱 All Users FCM Tokens:', users);

        res.status(200).json({
            success: true,
            users: users
        });
    } catch (error) {
        console.error('\n❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📡 Listening for new events in Firestore...`);
});