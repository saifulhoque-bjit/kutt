const query = require("./queries");
const utils = require("./utils");

// check and delete links 30 secoonds
setInterval(function () {
  query.link.batchRemove({ expire_in: ["<", utils.dateToUTC(new Date())] }).catch(function(error) {
    console.error("Remove expired links error: ", error);
  });
}, 30_000);
