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

// Helper function to format notification content
function formatNotificationContent(event) {
    const shortDescription = event.description.length > 60 
        ? event.description.substring(0, 60) + '...'
        : event.description;

    const expandedBody = [
        shortDescription,
        `📅 ${event.date} at ${event.time}`,
        `⏰ Register by: ${event.registrationDeadline}`,
        '🔗 Tap to register'
    ].join('\n');

    return {
        shortDescription,
        expandedBody
    };
}

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

        // Get formatted content
        const { expandedBody } = formatNotificationContent(event);

        const message = {
            notification: {
                title: `New Event: ${event.title}`,
                body: expandedBody
            },
            data: {
                eventId: event.id,
                title: event.title,
                description: event.description,
                imageUrl: event.imageRes || '', // Only in data
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

        // Debug logging
        console.log('\n📤 Sending notification details:', {
            title: event.title,
            description: event.description,
            imageUrl: event.imageRes,
            formLink: event.formLink,
            date: event.date,
            time: event.time,
            registrationDeadline: event.registrationDeadline
        });

        const response = await admin.messaging().sendEachForMulticast(message);
        console.log(`✅ Notification sent: Success: ${response.successCount}, Failed: ${response.failureCount}`);

        if (response.failureCount > 0) {
            response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                    console.error(`Failed to send to token ${tokens[idx]}:`, resp.error);
                }
            });
        }
    } catch (error) {
        console.error('Error sending notification:', error);
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

// Keep the check-tokens endpoint for testing
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


// Function to send update notification
async function sendUpdateNotification(release) {
    try {
        // Get all users with FCM tokens
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

        // Format release notes
        const releaseNotes = release.body || 'No release notes available';
        
        const message = {
            notification: {
                title: `🚀 New Update Available: ${release.tag_name}`,
                body: `${release.name || 'New version available!'}\n\nTap to update.`
            },
            data: {
                type: "APP_UPDATE",
                version: release.tag_name,
                releaseNotes: releaseNotes,
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

// GitHub webhook endpoint
app.post('/github-webhook', async (req, res) => {
    const event = req.headers['x-github-event'];
    const signature = req.headers['x-hub-signature-256'];
    
    // Verify it's a release event
    if (event === 'release' && req.body.action === 'published') {
        console.log('📦 New release detected:', req.body.release.tag_name);
        await sendUpdateNotification(req.body.release);
    }
    
    res.status(200).send('OK');
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📡 Listening for new events in Firestore...`);
});