// src/utils/firebaseUpload.js
const storage = require('./storage');
// const { v4: uuidv4 } = require('uuid');

/**
 * 上傳單張圖片到 Firebase Storage
 * @param {Object} file - Multer 檔案物件
 * @param {string} folder - 儲存資料夾名稱
 * @param {string} prefix - 檔案名稱前綴
 * @returns {Promise<string>} - 回傳圖片的公開 URL
 */
async function uploadImageToFirebase(file, folder = 'uploads', prefix = '') {
  const timestamp = new Date().toISOString();
  const filename = `${folder}/${prefix}${timestamp}-${file.originalname}`;
  try {
    const url = await storage.upload(file.buffer, filename, file.mimetype);
    console.log(`✅ 圖片上傳成功: ${filename}`);
    return url;
  } catch (error) {
    console.error('❌ 圖片上傳錯誤:', error);
    throw new Error(`圖片上傳失敗: ${error.message}`);
  }
}

/**
 * 批量上傳產品圖片到 Firebase Storage
 * @param {Object} files - req.files 物件，包含所有上傳的圖片
 * @param {string} productName - 產品名稱，用於建立資料夾
 * @returns {Promise<Object>} - 回傳所有圖片的 URL
 */
async function uploadProductImages(files, productName) {
  try {
    console.log('🔄 開始批量上傳產品圖片...');
    
    // 清理產品名稱作為資料夾名稱
    const sanitizedName = productName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_');
    const folderName = `products/${sanitizedName}`;

    // 定義圖片欄位對應
    const imageFields = {
      product_cover_image: 'cover_',
      product_img1: 'img1_',
      product_img2: 'img2_',
      product_img3: 'img3_',
      product_img4: 'img4_',
      product_img5: 'img5_',
      product_img6: 'img6_',
      // 新增以下三個欄位
      feature_img1: 'feature1_',
      feature_img2: 'feature2_',
      feature_img3: 'feature3_',
    };

    const uploadPromises = [];
    const imageUrls = {};

    // 為每個圖片欄位建立上傳 Promise
    for (const [fieldName, prefix] of Object.entries(imageFields)) {
      if (files[fieldName] && files[fieldName][0]) {
        const file = files[fieldName][0];
        
        const uploadPromise = uploadImageToFirebase(file, folderName, prefix)
          .then(url => {
            imageUrls[fieldName] = url;
            console.log(`✅ ${fieldName} 上傳完成`);
          })
          .catch(error => {
            console.error(`❌ ${fieldName} 上傳失敗:`, error);
            throw new Error(`${fieldName} 上傳失敗: ${error.message}`);
          });
          
        uploadPromises.push(uploadPromise);
      }
    }

    // 等待所有圖片上傳完成
    await Promise.all(uploadPromises);
    
    console.log('✅ 所有產品圖片上傳完成');
    return imageUrls;
    
  } catch (error) {
    console.error('❌ 批量上傳圖片錯誤:', error);
    throw new Error(`批量上傳失敗: ${error.message}`);
  }
}

/**
 * 上傳使用者頭像到 Firebase Storage (兼容 No.12，但當前不使用)
 * @param {Object} file - Multer 檔案物件
 * @param {string} userId - 使用者ID (可選)
 * @returns {Promise<string>} - 回傳圖片的公開 URL
 */
async function uploadUserAvatar(file, userId = '') {
  try {
    console.log(`🔄 開始上傳使用者頭像...`);
    
    const folderName = 'userProfile';
    const prefix = userId ? `user_${userId}_` : '';
    
    const url = await uploadImageToFirebase(file, folderName, prefix);
    
    console.log(`✅ 使用者頭像上傳完成`);
    return url;
    
  } catch (error) {
    console.error(`❌ 使用者頭像上傳失敗:`, error);
    throw new Error(`頭像上傳失敗: ${error.message}`);
  }
}

// 未來如果需要其他類型的圖片上傳，可以在這裡添加新函數

/**
 * 刪除 Firebase Storage 中的檔案
 * @param {string} fileUrl - 檔案的公開 URL
 * @returns {Promise<boolean>} - 刪除是否成功
 */
async function deleteImageFromFirebase(fileUrl) {
  try {
    const ok = await storage.remove(fileUrl);
    if (ok) console.log(`✅ 檔案刪除成功: ${fileUrl}`);
    return ok;
  } catch (error) {
    console.error('❌ 檔案刪除失敗:', error);
    return false;
  }
}

module.exports = {
  uploadImageToFirebase,
  uploadProductImages,
  uploadUserAvatar,      // 提供給未來的 No.12 使用，但當前不改變 No.12
  deleteImageFromFirebase,
};