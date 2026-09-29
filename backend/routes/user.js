const express = require('express')
const router = express.Router()
const passport = require('passport')
const userController = require('../controllers/userController')
const { verifyOTP, loginWithOTP, loginUserMob, updateUserByemail, signupUser, loginUser, updateProfil, getUsersByEmail, getUserById, getUsers, createUser, deleteUser, updateUser } = require('../controllers/userController')
//login route

router.post('/login', loginUser)
router.post('/loginotp', loginWithOTP)
router.post('/verify-otp', verifyOTP);
router.post('/loginMob', loginUserMob)
//signup route

router.post('/signup', signupUser)
//get users
router.get('/list', getUsers)
//get usersby email
router.get('/email/:email', getUsersByEmail)
router.patch('/email/:email', updateUserByemail)
//get usersby id
router.get('/id/:id', getUserById)
// POST user
router.post('/add', createUser)
// DELETE user
router.delete('/:id', deleteUser)
// UPDATE user
router.patch('/:id', updateUser)
//UPDATE Profil
router.patch('/:id', updateProfil)
//client number
//helpdesk number
//technicien number
router.get('/profile/:userId', userController.getUserById);
router.get('/role/:role', userController.getUserByRole);
module.exports = router 