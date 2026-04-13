/**
 * VenuePhotoUpload — lets authenticated users submit a photo for a venue.
 *
 * Privacy / safety design:
 * - Shows a consent alert before the picker opens. The user must explicitly
 *   agree before proceeding (ICO Children's Code — informed consent).
 * - EXIF stripping (incl. GPS) happens inside useUploadVenuePhoto before
 *   bytes reach the network.
 * - If the user is not authenticated, the component renders nothing — the
 *   upload route is meaningless without an account.
 */
import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../store/authStore';
import { useUploadVenuePhoto } from '../../hooks/useVenuePhotos';

interface Props {
  venueId: string;
}

export function VenuePhotoUpload({ venueId }: Props) {
  const user = useAuthStore((s) => s.user);
  const uploadMutation = useUploadVenuePhoto();

  // B1 — Guard callbacks against firing after the component has unmounted
  // (e.g. user navigates away while picker is open).
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // B6 — Synchronous ref prevents a double-tap from racing past the
  // disabled check (state updates are async; refs are not).
  const pickingRef = useRef(false);

  // Not signed in — nothing to render.
  if (!user) return null;

  const launchPicker = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        // P1 — quality: 1 skips the picker's own lossy JPEG encode.
        // The only encode is the re-encode inside useUploadVenuePhoto
        // (compress: 0.85) which also strips EXIF/GPS. Two lossy encodes
        // in sequence degrade quality multiplicatively.
        quality: 1,
        exifData: false,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;

      // B1 — Pass callbacks inline so we can guard them with mountedRef.
      uploadMutation.mutate(
        { venueId, imageUri: result.assets[0].uri },
        {
          onSuccess: () => {
            if (mountedRef.current) {
              Alert.alert('Photo submitted', 'Photo submitted for review. It will appear once approved.');
            }
          },
          onError: () => {
            if (mountedRef.current) {
              Alert.alert('Upload failed', 'Please try again.');
            }
          },
        }
      );
    } finally {
      // B6 — Always release the lock so later taps work after picker closes.
      pickingRef.current = false;
    }
  };

  const handlePress = () => {
    // B6 — Bail immediately if a pick or upload is already in progress.
    if (pickingRef.current || uploadMutation.isPending) return;
    pickingRef.current = true;

    // S2 — "I agree & continue" makes consent explicit.
    // A passive information alert does not satisfy the ICO Children's Code
    // requirement for informed, unambiguous consent before data collection.
    Alert.alert(
      'Photo guidelines',
      'Please upload photos of the venue, not people. Photos containing identifiable children will be rejected.\n\nBy continuing you confirm you have the right to share this image and it does not contain identifiable children without parental consent.',
      [
        {
          text: 'Cancel',
          style: 'cancel',
          onPress: () => { pickingRef.current = false; },
        },
        {
          text: 'I agree & continue',
          onPress: launchPicker,
        },
      ]
    );
  };

  return (
    <View className="mt-4">
      <TouchableOpacity
        className="flex-row items-center justify-center bg-sky rounded-xl py-3 px-4 gap-2"
        onPress={handlePress}
        disabled={uploadMutation.isPending}
        accessibilityLabel="Add a photo of this venue"
        accessibilityRole="button"
      >
        {uploadMutation.isPending ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text className="text-white font-bold">Add a photo</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
