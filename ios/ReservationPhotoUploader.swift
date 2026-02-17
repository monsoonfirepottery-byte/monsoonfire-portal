import Foundation

#if canImport(FirebaseStorage)
import FirebaseStorage
#endif

enum ReservationPhotoUploadError: Error, CustomStringConvertible {
    case invalidOwnerUid
    case fileTooLarge(Int)
    case unsupportedImageType
    case unreadableFile
    case storageUnavailable
    case uploadFailed(String)

    var description: String {
        switch self {
        case .invalidOwnerUid:
            return "Owner UID is required for photo upload."
        case .fileTooLarge(let limit):
            return "Photo exceeds size limit of \(limit / (1024 * 1024)) MB."
        case .unsupportedImageType:
            return "Unsupported image type. Use jpg, jpeg, png, heic, or webp."
        case .unreadableFile:
            return "Selected photo could not be read."
        case .storageUnavailable:
            return "Firebase Storage SDK is not available in this build."
        case .uploadFailed(let s):
            return "Photo upload failed: \(s)"
        }
    }
}

struct ReservationPhotoUploadResult {
    let url: String
    let path: String
}

enum ReservationPhotoUploader {
    private static let maxBytes = 10 * 1024 * 1024
    private static let allowedExtensions = Set(["jpg", "jpeg", "png", "heic", "webp"])

    static func uploadPhoto(
        ownerUid: String,
        requestId: String,
        fileUrl: URL
    ) async throws -> ReservationPhotoUploadResult {
        let safeOwnerUid = ownerUid.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !safeOwnerUid.isEmpty else {
            throw ReservationPhotoUploadError.invalidOwnerUid
        }

        let ext = fileUrl.pathExtension.lowercased()
        guard allowedExtensions.contains(ext) else {
            throw ReservationPhotoUploadError.unsupportedImageType
        }

        guard let data = try? Data(contentsOf: fileUrl) else {
            throw ReservationPhotoUploadError.unreadableFile
        }

        guard data.count <= maxBytes else {
            throw ReservationPhotoUploadError.fileTooLarge(maxBytes)
        }

        let safeFileName = sanitizeFileName(fileUrl.lastPathComponent)
        let path = "checkins/\(safeOwnerUid)/\(requestId)/\(safeFileName)"

        #if canImport(FirebaseStorage)
        let ref = Storage.storage().reference(withPath: path)
        let metadata = StorageMetadata()
        metadata.contentType = mimeType(for: ext)

        do {
            _ = try await ref.putDataAsync(data, metadata: metadata)
            let downloadUrl = try await ref.downloadURL()
            return ReservationPhotoUploadResult(url: downloadUrl.absoluteString, path: path)
        } catch {
            throw ReservationPhotoUploadError.uploadFailed(error.localizedDescription)
        }
        #else
        throw ReservationPhotoUploadError.storageUnavailable
        #endif
    }

    private static func sanitizeFileName(_ name: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "._-"))
        let cleanedScalars = name.unicodeScalars.map { allowed.contains($0) ? Character($0) : "_" }
        let candidate = String(cleanedScalars)
        return candidate.isEmpty ? "upload.jpg" : candidate
    }

    private static func mimeType(for ext: String) -> String {
        switch ext {
        case "jpg", "jpeg": return "image/jpeg"
        case "png": return "image/png"
        case "heic": return "image/heic"
        case "webp": return "image/webp"
        default: return "application/octet-stream"
        }
    }
}
