import React, { useState, useRef } from 'react';

export default function PfpUploader({ onImageLoaded, defaultImage }) {
  const [preview, setPreview] = useState(defaultImage || '');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Helper to convert File object to Base64
  const processFile = (file) => {
    if (!file) return;

    // 1. Validation: Only allow images
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (PNG, JPG, WEBP).');
      return;
    }

    // 2. Validation: Limit file size to 5MB to prevent memory issues
    if (file.size > 5 * 1024 * 1024) {
      alert('File is too large. Please select an image under 5MB.');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result;
      setPreview(base64String); // Update local visual state
      
      if (onImageLoaded) {
        onImageLoaded(base64String); // Pass Base64 string back to parent component
      }
    };
    reader.readAsDataURL(file);
  };

  // Handle standard input change
  const handleFileChange = (e) => {
    const file = e.target.files[0];
    processFile(file);
  };

  // Trigger file input click when clicking the avatar preview container
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  // Handle Drag & Drop interactions
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    processFile(file);
  };

  // Reset/Remove Profile Picture
  const handleRemoveImage = (e) => {
    e.stopPropagation(); // Stop click from triggering the file upload modal
    setPreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (onImageLoaded) onImageLoaded(''); // Inform parent that PFP is cleared
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
      <div
        onClick={triggerFileInput}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          position: 'relative',
          width: '120px',
          height: '120px',
          borderRadius: '50%',
          cursor: 'pointer',
          border: isDragging ? '3px dashed #3b82f6' : '3px solid #e2e8f0',
          backgroundColor: isDragging ? '#eff6ff' : '#f8fafc',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          transition: 'all 0.2s ease-in-out',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)'
        }}
        title="Click or drag an image to upload"
      >
        {preview ? (
          <img
            src={preview}
            alt="PFP Preview"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover'
            }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px', textAlign: 'center' }}>
            <span style={{ fontSize: '24px' }}>📷</span>
            <span style={{ fontSize: '11px', color: '#64748b', fontWeight: '500' }}>
              Drag & Drop <br /> or Click
            </span>
          </div>
        )}

        {/* Edit Button Overlay */}
        <div style={{
          position: 'absolute',
          bottom: '0',
          left: '0',
          right: '0',
          height: '32px',
          backgroundColor: 'rgba(15, 23, 42, 0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: '11px',
          fontWeight: 'bold',
          opacity: preview ? 0 : 1, // Only show automatically on hover if image exists
          transition: 'opacity 0.2s',
        }}
        className="hover-overlay"
        >
          Change
        </div>
      </div>

      {/* Action Buttons underneath */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          type="button"
          onClick={triggerFileInput}
          style={{
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: '600',
            backgroundColor: '#fff',
            color: '#1e293b',
            border: '1px solid #cbd5e1',
            borderRadius: '6px',
            cursor: 'pointer'
          }}
        >
          Choose File
        </button>
        {preview && (
          <button
            type="button"
            onClick={handleRemoveImage}
            style={{
              padding: '6px 12px',
              fontSize: '12px',
              fontWeight: '600',
              backgroundColor: '#fee2e2',
              color: '#ef4444',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer'
            }}
          >
            Remove
          </button>
        )}
      </div>

      {/* Hidden native file input */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* Hover styling rule inject */}
      <style>{`
        div:hover .hover-overlay {
          opacity: 1 !important;
        }
      `}</style>
    </div>
  );
}