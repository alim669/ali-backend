const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: "df2y8lsqp",
  api_key: "417648631444543",
  api_secret: "ncTUSaG9pZdWjvQ1usyo3Wej-VM"
});

const base64Image = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

cloudinary.uploader.upload(base64Image, { folder: "test" })
  .then(result => {
    console.log("SUCCESS!");
    console.log("URL:", result.secure_url);
    console.log("Public ID:", result.public_id);
  })
  .catch(err => {
    console.log("ERROR:", err.message);
  });
