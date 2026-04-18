# Firebase Setup for the Study Board

## 1. Create a Firebase project
- Open Firebase Console
- Create a new project
- Add a Web app

## 2. Enable Authentication
- Go to Authentication
- Enable Email/Password sign-in
- Create your admin user account

## 3. Enable Firestore Database
- Create a Firestore database in production or test mode
- Add a collection named posts

Suggested fields for each post:
- title
- category
- summary
- content
- createdAt
- updatedAt

## 4. Update the site config
Open firebase-config.js and replace the placeholder values with your Firebase Web app configuration.
Also change adminEmail to your own email address.

## 5. Firestore rules example
Use a rule similar to this in Firebase:

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /posts/{postId} {
      allow read: if true;
      allow create, update, delete: if request.auth != null && request.auth.token.email == 'your-email@example.com';
    }
  }
}

## 6. Publish the site
Commit and push the changes to GitHub Pages.
After deployment, open the blog page and sign in to publish posts.
