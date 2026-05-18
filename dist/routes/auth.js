"use strict";
const express = require("express");
const router = express.Router();
const USUARIO = 'Ungrd';
const PASSWORD = 'Ungrd.2026';
router.post('/api/login', express.urlencoded({ extended: true }), (req, res) => {
    const { usuario, password } = req.body;
    if (usuario === USUARIO && password === PASSWORD) {
        req.session.autenticado = true;
        return res.redirect('/');
    }
    res.redirect('/login.html?error=1');
});
router.get('/api/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login.html'));
});
module.exports = router;
