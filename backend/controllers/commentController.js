const mongoose = require('mongoose');
const Post = require('../models/Post');
const Comment = require('../models/Comment');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// POST /api/posts/:postId/comments  { content, parent? }
exports.addComment = async (req, res) => {
  try {
    const { postId } = req.params;
    const { content, parent } = req.body;

    if (!isValidId(postId)) return res.status(400).json({ message: 'ID invalide' });
    if (!content || !content.trim()) return res.status(400).json({ message: 'Contenu obligatoire' });

    const post = await Post.findById(postId);
    if (!post) return res.status(404).json({ message: 'Annonce introuvable' });

    if (parent) {
      const parentComment = await Comment.findOne({ _id: parent, post: postId });
      if (!parentComment) return res.status(404).json({ message: 'Commentaire parent introuvable' });
    }

    const comment = await Comment.create({
      post: postId,
      author: req.user._id,
      content,
      parent: parent || null,
    });
    await Post.findByIdAndUpdate(postId, { $inc: { commentsCount: 1 } });

    await comment.populate('author', 'name avatar');
    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// GET /api/posts/:postId/comments?page=&limit=
exports.getComments = async (req, res) => {
  try {
    const { postId } = req.params;
    if (!isValidId(postId)) return res.status(400).json({ message: 'ID invalide' });

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    const [comments, total] = await Promise.all([
      Comment.find({ post: postId })
        .populate('author', 'name avatar')
        .sort({ createdAt: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Comment.countDocuments({ post: postId }),
    ]);

    res.json({ comments, page, pages: Math.ceil(total / limit), total });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// DELETE /api/comments/:id  (auteur ou admin)
exports.deleteComment = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'ID invalide' });

    const comment = await Comment.findById(req.params.id);
    if (!comment) return res.status(404).json({ message: 'Commentaire introuvable' });

    if (!comment.author.equals(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Action non autorisée' });
    }

    // Supprime aussi les réponses directes
    const { deletedCount } = await Comment.deleteMany({
      $or: [{ _id: comment._id }, { parent: comment._id }],
    });
    await Post.findByIdAndUpdate(comment.post, { $inc: { commentsCount: -deletedCount } });

    res.json({ message: 'Commentaire supprimé' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};
