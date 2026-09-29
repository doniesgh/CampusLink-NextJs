const express = require('express');
const router = express.Router();
const User = require('../models/userModel'); 
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken'); 

router.post('/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;

    try {
        const decoded = jwt.verify(token, 'votre_secret');
        const user = await User.findOne({ email: decoded.email });
        if (!user) {
            return res.status(404).send('Utilisateur non trouvé');
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        user.password = hashedPassword;
        await user.save();

        res.status(200).send('Mot de passe réinitialisé avec succès');
    } catch (error) {
        res.status(400).send('Erreur lors de la réinitialisation du mot de passe');
    }
});

module.exports = router;
