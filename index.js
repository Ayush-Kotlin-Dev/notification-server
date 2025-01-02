const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: serviceAccount.project_id,
});

// Endpoint to send notifications
app.post('/send-notification', async (req, res) => {
    try {
        const { title, description } = req.body;
        console.log('\n📩 Received request:', { title, description });

        // Get all user tokens from Firestore
        const usersSnapshot = await admin.firestore()
            .collection('users')
            .where('fcmToken', '!=', null)
            .where('isLoggedIn', '==', true)
            .get();

        // Log detailed user information
        console.log('\n👥 Found users:', usersSnapshot.size);
        usersSnapshot.docs.forEach((doc, index) => {
            const userData = doc.data();
            console.log(`\nUser ${index + 1}:`);
            console.log('- User ID:', doc.id);
            console.log('- Email:', userData.email);
            console.log('- FCM Token:', userData.fcmToken);
            console.log('- Login Status:', userData.isLoggedIn);
        });

        const tokens = usersSnapshot.docs
            .map(doc => doc.data().fcmToken)
            .filter(token => token);

        console.log('\n🎫 Valid FCM Tokens:', tokens);

        if (tokens.length === 0) {
            console.log('⚠️ No active users found with valid FCM tokens');
            return res.status(200).json({ message: 'No active users found' });
        }

        // Create the message
        const message = {
            notification: {
                title: `New Event: ${title}`,
                body: description
            },
            data: {
                type: 'event',
                eventId: Date.now().toString()
            },
            tokens: tokens
        };

        // Send the message
        const response = await admin.messaging().sendEachForMulticast(message);
        
        console.log('\n✅ FCM Response:', response);

        res.status(200).json({
            success: true,
            successCount: response.successCount,
            failureCount: response.failureCount,
            responses: response.responses
        });

    } catch (error) {
        console.error('\n❌ Error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// Add an endpoint to check all FCM tokens
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
});