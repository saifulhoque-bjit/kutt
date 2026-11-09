const { Router } = require("express");

const router = Router();

// SPEC: spec-883f26
router.get("/", (_, res) => res.status(200).json({ status: "ok" }));

module.exports = router;
