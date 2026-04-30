declare module 'firebase-admin' {
  namespace firestore {
    type DocumentData = any;
    type QueryDocumentSnapshot<T = DocumentData> = any;
    type CollectionReference<T = DocumentData> = any;
  }
  const admin: any;
  export default admin;
  export = admin;
}

declare module 'firebase-admin/firestore' {
  export const getFirestore: any;
}

declare namespace FirebaseFirestore {
  type Firestore = any;
  type QuerySnapshot = any;
}
