const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth');

const post = require('../controllers/postController');
const comment = require('../controllers/commentController');

// ---------- Annonces ----------
router.get('/posts', post.getPosts);                    // liste + filtres + recherche
router.get('/posts/me', protect, post.getMyPosts);      // mes annonces (avant /:id !)
router.get('/posts/:id', post.getPost);
router.post('/posts', protect, post.createPost);
router.put('/posts/:id', protect, post.updatePost);
router.patch('/posts/:id/status', protect, post.changeStatus);
router.delete('/posts/:id', protect, post.deletePost);
router.post('/posts/:id/like', protect, post.toggleLike);

// ---------- Commentaires ----------
router.get('/posts/:postId/comments', comment.getComments);
router.post('/posts/:postId/comments', protect, comment.addComment);
router.delete('/comments/:id', protect, comment.deleteComment);

module.exports = router;

