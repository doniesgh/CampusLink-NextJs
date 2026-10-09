const mongoose = require('mongoose');
const Post = require('../models/Post');
const Comment = require('../models/Comment');
const { POST_TYPES } = require('../models/Post');

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// Champs modifiables par l'auteur
const EDITABLE = [
  'title', 'description', 'tags', 'images', 'location',
  'covoiturage', 'objetPerdu', 'status',
];

// POST /api/posts
exports.createPost = async (req, res) => {
  try {
    const { type, title, description } = req.body;

    if (!POST_TYPES.includes(type)) {
      return res.status(400).json({ message: `Type invalide. Valeurs : ${POST_TYPES.join(', ')}` });
    }
    if (!title || !description) {
      return res.status(400).json({ message: 'Titre et description obligatoires' });
    }
    if (type === 'covoiturage') {
      const c = req.body.covoiturage || {};
      if (!c.departure || !c.destination || !c.departureDate || !c.seats) {
        return res.status(400).json({ message: 'Covoiturage : départ, destination, date et places requis' });
      }
    }
    if (type === 'objet_perdu') {
      const o = req.body.objetPerdu || {};
      if (!['perdu', 'trouve'].includes(o.kind)) {
        return res.status(400).json({ message: "Objet : kind doit être 'perdu' ou 'trouve'" });
      }
    }

    const data = { type, author: req.user._id };
    EDITABLE.forEach((f) => { if (req.body[f] !== undefined && f !== 'status') data[f] = req.body[f]; });

    const post = await Post.create(data);
    res.status(201).json(post);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// GET /api/posts?type=&status=&q=&tag=&author=&page=&limit=&sort=
exports.getPosts = async (req, res) => {
  try {
    const { type, status = 'active', q, tag, author, sort = 'recent' } = req.query;
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const filter = {};
    if (type) filter.type = type;
    if (status !== 'all') filter.status = status;
    if (tag) filter.tags = tag.toLowerCase();
    if (author && isValidId(author)) filter.author = author;
    if (q) filter.$text = { $search: q };

    const sortBy = sort === 'popular' ? { likesCount: -1, createdAt: -1 } : { createdAt: -1 };

    const [posts, total] = await Promise.all([
      Post.find(filter)
        .populate('author', 'name avatar')
        .sort(sortBy)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Post.countDocuments(filter),
    ]);

    res.json({ posts, page, pages: Math.ceil(total / limit), total });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// GET /api/posts/:id
exports.getPost = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'ID invalide' });

    const post = await Post.findByIdAndUpdate(req.params.id, { $inc: { views: 1 } }, { new: true })
      .populate('author', 'name avatar');
    if (!post) return res.status(404).json({ message: 'Annonce introuvable' });

    res.json(post);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// PUT /api/posts/:id  (auteur ou admin)
exports.updatePost = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'ID invalide' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Annonce introuvable' });

    const isOwner = post.author.equals(req.user._id);
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Action non autorisée' });
    }

    EDITABLE.forEach((f) => { if (req.body[f] !== undefined) post[f] = req.body[f]; });
    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// DELETE /api/posts/:id  (auteur ou admin)
exports.deletePost = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'ID invalide' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Annonce introuvable' });

    const isOwner = post.author.equals(req.user._id);
    if (!isOwner && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Action non autorisée' });
    }

    await Promise.all([post.deleteOne(), Comment.deleteMany({ post: post._id })]);
    res.json({ message: 'Annonce supprimée' });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// POST /api/posts/:id/like  (toggle)
exports.toggleLike = async (req, res) => {
  try {
    if (!isValidId(req.params.id)) return res.status(400).json({ message: 'ID invalide' });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Annonce introuvable' });

    const idx = post.likes.findIndex((u) => u.equals(req.user._id));
    if (idx === -1) post.likes.push(req.user._id);
    else post.likes.splice(idx, 1);

    post.likesCount = post.likes.length;
    await post.save();

    res.json({ liked: idx === -1, likesCount: post.likesCount });
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// PATCH /api/posts/:id/status  { status: 'active' | 'closed' | 'resolved' }
exports.changeStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'closed', 'resolved'].includes(status)) {
      return res.status(400).json({ message: 'Statut invalide' });
    }
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ message: 'Annonce introuvable' });

    if (!post.author.equals(req.user._id) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Action non autorisée' });
    }
    post.status = status;
    await post.save();
    res.json(post);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};

// GET /api/posts/me
exports.getMyPosts = async (req, res) => {
  try {
    const posts = await Post.find({ author: req.user._id }).sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    res.status(500).json({ message: 'Erreur serveur', error: err.message });
  }
};
